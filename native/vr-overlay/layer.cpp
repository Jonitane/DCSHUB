#define XR_USE_PLATFORM_WIN32
#define XR_USE_GRAPHICS_API_D3D11
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <d3d11.h>
#include <dxgi.h>

#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>
#include <openxr/openxr_loader_negotiation.h>

#include "shared_protocol.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>
#include <cwctype>

#define LAYER_EXPORT __declspec(dllexport)

namespace {

constexpr char kLayerName[] = "XR_APILAYER_DCSHUB_manual_overlay";

struct Dispatch {
  PFN_xrGetInstanceProcAddr getInstanceProcAddr = nullptr;
  PFN_xrDestroyInstance destroyInstance = nullptr;
  PFN_xrCreateSession createSession = nullptr;
  PFN_xrDestroySession destroySession = nullptr;
  PFN_xrCreateReferenceSpace createReferenceSpace = nullptr;
  PFN_xrDestroySpace destroySpace = nullptr;
  PFN_xrLocateSpace locateSpace = nullptr;
  PFN_xrEnumerateSwapchainFormats enumerateSwapchainFormats = nullptr;
  PFN_xrCreateSwapchain createSwapchain = nullptr;
  PFN_xrDestroySwapchain destroySwapchain = nullptr;
  PFN_xrEnumerateSwapchainImages enumerateSwapchainImages = nullptr;
  PFN_xrAcquireSwapchainImage acquireSwapchainImage = nullptr;
  PFN_xrWaitSwapchainImage waitSwapchainImage = nullptr;
  PFN_xrReleaseSwapchainImage releaseSwapchainImage = nullptr;
  PFN_xrEndFrame endFrame = nullptr;
};

struct SharedFrame {
  bool active = false;
  std::uint32_t width = 0;
  std::uint32_t height = 0;
  std::uint32_t stride = 0;
  std::uint32_t sequence = 0;
  float widthMeters = 1.2F;
  float heightMeters = 0.8F;
  float distanceMeters = 1.0F;
  float orbitYawRadians = 0.0F;
  float orbitPitchRadians = 0.0F;
  std::uint32_t recenterSequence = 0;
  std::vector<std::uint8_t> pixels;
};

class SharedFrameReader {
 public:
  ~SharedFrameReader() { close(); }

  bool read(SharedFrame& frame) {
    if (!ensureOpen()) return false;
    if (WaitForSingleObject(mutex_, 2) != WAIT_OBJECT_0) return false;
    const auto release = [this]() { ReleaseMutex(mutex_); };
    const auto* header = reinterpret_cast<const dcshub::vr::SharedOverlayHeader*>(view_);
    if (header->magic != dcshub::vr::kSharedMagic || header->version != dcshub::vr::kSharedVersion) {
      release();
      return false;
    }
    frame.active = header->active != 0;
    frame.sequence = header->sequence;
    frame.widthMeters = header->widthMeters;
    frame.heightMeters = header->heightMeters;
    frame.distanceMeters = header->distanceMeters;
    frame.orbitYawRadians = header->orbitYawRadians;
    frame.orbitPitchRadians = header->orbitPitchRadians;
    frame.recenterSequence = header->recenterSequence;
    const auto byteCount = static_cast<std::uint64_t>(header->stride) * header->height;
    if (!frame.active || header->width == 0 || header->height == 0 || header->width > dcshub::vr::kMaxWidth ||
        header->height > dcshub::vr::kMaxHeight || header->stride < header->width * 4 || byteCount > header->capacity) {
      release();
      frame.active = false;
      return true;
    }
    frame.width = header->width;
    frame.height = header->height;
    frame.stride = header->stride;
    frame.pixels.resize(static_cast<std::size_t>(byteCount));
    std::memcpy(frame.pixels.data(), view_ + sizeof(dcshub::vr::SharedOverlayHeader), frame.pixels.size());
    release();
    return true;
  }

 private:
  bool ensureOpen() {
    if (view_ && mutex_) return true;
    close();
    mutex_ = OpenMutexA(SYNCHRONIZE | MUTEX_MODIFY_STATE, FALSE, dcshub::vr::kMutexName);
    mapping_ = OpenFileMappingA(FILE_MAP_READ, FALSE, dcshub::vr::kMappingName);
    if (!mutex_ || !mapping_) {
      close();
      return false;
    }
    view_ = static_cast<const std::uint8_t*>(MapViewOfFile(mapping_, FILE_MAP_READ, 0, 0, 0));
    if (!view_) {
      close();
      return false;
    }
    return true;
  }

  void close() {
    if (view_) UnmapViewOfFile(view_);
    if (mapping_) CloseHandle(mapping_);
    if (mutex_) CloseHandle(mutex_);
    view_ = nullptr;
    mapping_ = nullptr;
    mutex_ = nullptr;
  }

  HANDLE mapping_ = nullptr;
  HANDLE mutex_ = nullptr;
  const std::uint8_t* view_ = nullptr;
};

struct SessionState {
  XrSession session = XR_NULL_HANDLE;
  ID3D11Device* device = nullptr;
  ID3D11DeviceContext* context = nullptr;
  XrSpace viewSpace = XR_NULL_HANDLE;
  XrSpace localSpace = XR_NULL_HANDLE;
  XrPosef recenterPose{{0.0F, 0.0F, 0.0F, 1.0F}, {0.0F, 0.0F, 0.0F}};
  std::uint32_t appliedRecenterSequence = 0;
  bool recenterValid = false;
  XrSwapchain swapchain = XR_NULL_HANDLE;
  std::vector<XrSwapchainImageD3D11KHR> images;
  std::vector<std::uint8_t> converted;
  std::int64_t swapchainFormat = 0;
  std::uint32_t width = 0;
  std::uint32_t height = 0;
  std::uint32_t uploadedSequence = 0;
  bool firstFrameLogged = false;
  bool submissionFailureLogged = false;

  ~SessionState() {
    if (context) context->Release();
    if (device) device->Release();
  }
};

std::mutex gMutex;
XrInstance gInstance = XR_NULL_HANDLE;
Dispatch gDispatch;
SharedFrameReader gSharedReader;
std::unordered_map<XrSession, std::unique_ptr<SessionState>> gSessions;
bool gOverlayEnabled = false;

bool isDcsProcess() {
  wchar_t executablePath[32768]{};
  const DWORD length = GetModuleFileNameW(nullptr, executablePath, static_cast<DWORD>(std::size(executablePath)));
  if (length == 0 || length >= std::size(executablePath)) return false;
  std::wstring_view path(executablePath, length);
  const auto separator = path.find_last_of(L"\\/");
  std::wstring name(path.substr(separator == std::wstring_view::npos ? 0 : separator + 1));
  std::transform(name.begin(), name.end(), name.begin(), [](wchar_t value) { return std::towlower(value); });
  return name == L"dcs.exe" || name == L"dcs-mt.exe";
}

std::wstring configuredLogPath() {
  wchar_t directory[32768]{};
  DWORD bytes = sizeof(directory);
  const LSTATUS status = RegGetValueW(
    HKEY_CURRENT_USER,
    L"SOFTWARE\\DCSHUB",
    L"OpenXrLogDirectory",
    RRF_RT_REG_SZ,
    nullptr,
    directory,
    &bytes);
  if (status != ERROR_SUCCESS || directory[0] == L'\0') return {};
  std::wstring result(directory);
  CreateDirectoryW(result.c_str(), nullptr);
  if (!result.empty() && result.back() != L'\\' && result.back() != L'/') result += L'\\';
  result += L"openxr-overlay.log";
  return result;
}

void logLine(const char* message) {
  const std::wstring logPath = configuredLogPath();
  if (logPath.empty()) return;
  FILE* file = nullptr;
  if (_wfopen_s(&file, logPath.c_str(), L"a") != 0 || !file) return;
  SYSTEMTIME time{};
  GetLocalTime(&time);
  std::fprintf(file, "%04u-%02u-%02u %02u:%02u:%02u.%03u [PID %lu] %s\n",
    time.wYear, time.wMonth, time.wDay, time.wHour, time.wMinute, time.wSecond, time.wMilliseconds,
    GetCurrentProcessId(), message);
  std::fclose(file);
}

template <typename T>
bool loadFunction(XrInstance instance, const char* name, T& function) {
  PFN_xrVoidFunction raw = nullptr;
  if (!gDispatch.getInstanceProcAddr || XR_FAILED(gDispatch.getInstanceProcAddr(instance, name, &raw)) || !raw) return false;
  function = reinterpret_cast<T>(raw);
  return true;
}

bool populateDispatch(XrInstance instance) {
  return loadFunction(instance, "xrDestroyInstance", gDispatch.destroyInstance) &&
    loadFunction(instance, "xrCreateSession", gDispatch.createSession) &&
    loadFunction(instance, "xrDestroySession", gDispatch.destroySession) &&
    loadFunction(instance, "xrCreateReferenceSpace", gDispatch.createReferenceSpace) &&
    loadFunction(instance, "xrDestroySpace", gDispatch.destroySpace) &&
    loadFunction(instance, "xrLocateSpace", gDispatch.locateSpace) &&
    loadFunction(instance, "xrEnumerateSwapchainFormats", gDispatch.enumerateSwapchainFormats) &&
    loadFunction(instance, "xrCreateSwapchain", gDispatch.createSwapchain) &&
    loadFunction(instance, "xrDestroySwapchain", gDispatch.destroySwapchain) &&
    loadFunction(instance, "xrEnumerateSwapchainImages", gDispatch.enumerateSwapchainImages) &&
    loadFunction(instance, "xrAcquireSwapchainImage", gDispatch.acquireSwapchainImage) &&
    loadFunction(instance, "xrWaitSwapchainImage", gDispatch.waitSwapchainImage) &&
    loadFunction(instance, "xrReleaseSwapchainImage", gDispatch.releaseSwapchainImage) &&
    loadFunction(instance, "xrEndFrame", gDispatch.endFrame);
}

const XrGraphicsBindingD3D11KHR* findD3D11Binding(const void* next) {
  auto* current = static_cast<const XrBaseInStructure*>(next);
  while (current) {
    if (current->type == XR_TYPE_GRAPHICS_BINDING_D3D11_KHR) return reinterpret_cast<const XrGraphicsBindingD3D11KHR*>(current);
    current = current->next;
  }
  return nullptr;
}

void destroySwapchain(SessionState& state) {
  if (state.swapchain != XR_NULL_HANDLE && gDispatch.destroySwapchain) gDispatch.destroySwapchain(state.swapchain);
  state.swapchain = XR_NULL_HANDLE;
  state.images.clear();
  state.width = 0;
  state.height = 0;
  state.uploadedSequence = 0;
}

bool ensureReferenceSpaces(SessionState& state) {
  if (state.viewSpace == XR_NULL_HANDLE) {
    XrReferenceSpaceCreateInfo spaceInfo{XR_TYPE_REFERENCE_SPACE_CREATE_INFO};
    spaceInfo.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_VIEW;
    spaceInfo.poseInReferenceSpace.orientation.w = 1.0F;
    const XrResult spaceResult = gDispatch.createReferenceSpace(state.session, &spaceInfo, &state.viewSpace);
    if (XR_FAILED(spaceResult)) {
      logLine("Failed to create VIEW reference space for Super Manual overlay");
      return false;
    }
  }
  if (state.localSpace == XR_NULL_HANDLE) {
    XrReferenceSpaceCreateInfo spaceInfo{XR_TYPE_REFERENCE_SPACE_CREATE_INFO};
    spaceInfo.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_LOCAL;
    spaceInfo.poseInReferenceSpace.orientation.w = 1.0F;
    const XrResult spaceResult = gDispatch.createReferenceSpace(state.session, &spaceInfo, &state.localSpace);
    if (XR_FAILED(spaceResult)) {
      logLine("Failed to create LOCAL reference space for Super Manual overlay");
      return false;
    }
  }
  return true;
}

bool createOverlayResources(SessionState& state, std::uint32_t width, std::uint32_t height) {
  destroySwapchain(state);
  if (!ensureReferenceSpaces(state)) return false;

  std::uint32_t formatCount = 0;
  if (XR_FAILED(gDispatch.enumerateSwapchainFormats(state.session, 0, &formatCount, nullptr)) || formatCount == 0) {
    logLine("OpenXR runtime returned no overlay swapchain formats");
    return false;
  }
  std::vector<std::int64_t> formats(formatCount);
  if (XR_FAILED(gDispatch.enumerateSwapchainFormats(state.session, formatCount, &formatCount, formats.data()))) return false;
  constexpr std::int64_t preferred[] = {
    DXGI_FORMAT_B8G8R8A8_UNORM,
    DXGI_FORMAT_B8G8R8A8_UNORM_SRGB,
    DXGI_FORMAT_R8G8B8A8_UNORM,
    DXGI_FORMAT_R8G8B8A8_UNORM_SRGB,
  };
  state.swapchainFormat = 0;
  for (const auto candidate : preferred) {
    if (std::find(formats.begin(), formats.end(), candidate) != formats.end()) {
      state.swapchainFormat = candidate;
      break;
    }
  }
  if (state.swapchainFormat == 0) {
    logLine("OpenXR runtime exposes no compatible RGBA/BGRA overlay format");
    return false;
  }

  XrSwapchainCreateInfo createInfo{XR_TYPE_SWAPCHAIN_CREATE_INFO};
  createInfo.usageFlags = XR_SWAPCHAIN_USAGE_SAMPLED_BIT | XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT;
  createInfo.format = state.swapchainFormat;
  createInfo.sampleCount = 1;
  createInfo.width = width;
  createInfo.height = height;
  createInfo.faceCount = 1;
  createInfo.arraySize = 1;
  createInfo.mipCount = 1;
  const XrResult swapchainResult = gDispatch.createSwapchain(state.session, &createInfo, &state.swapchain);
  if (XR_FAILED(swapchainResult)) {
    logLine("Failed to create OpenXR swapchain for Super Manual overlay");
    return false;
  }

  std::uint32_t imageCount = 0;
  if (XR_FAILED(gDispatch.enumerateSwapchainImages(state.swapchain, 0, &imageCount, nullptr)) || imageCount == 0) {
    destroySwapchain(state);
    return false;
  }
  state.images.assign(imageCount, XrSwapchainImageD3D11KHR{XR_TYPE_SWAPCHAIN_IMAGE_D3D11_KHR});
  if (XR_FAILED(gDispatch.enumerateSwapchainImages(
      state.swapchain, imageCount, &imageCount, reinterpret_cast<XrSwapchainImageBaseHeader*>(state.images.data())))) {
    destroySwapchain(state);
    return false;
  }
  state.width = width;
  state.height = height;
  logLine("OpenXR D3D11 swapchain created for Super Manual overlay");
  return true;
}

const std::uint8_t* preparePixels(SessionState& state, const SharedFrame& frame) {
  if (state.swapchainFormat == DXGI_FORMAT_B8G8R8A8_UNORM || state.swapchainFormat == DXGI_FORMAT_B8G8R8A8_UNORM_SRGB) {
    return frame.pixels.data();
  }
  state.converted.resize(frame.pixels.size());
  for (std::uint32_t y = 0; y < frame.height; ++y) {
    const auto* source = frame.pixels.data() + static_cast<std::size_t>(y) * frame.stride;
    auto* target = state.converted.data() + static_cast<std::size_t>(y) * frame.stride;
    for (std::uint32_t x = 0; x < frame.width; ++x) {
      target[x * 4 + 0] = source[x * 4 + 2];
      target[x * 4 + 1] = source[x * 4 + 1];
      target[x * 4 + 2] = source[x * 4 + 0];
      target[x * 4 + 3] = source[x * 4 + 3];
    }
  }
  return state.converted.data();
}

bool uploadFrame(SessionState& state, const SharedFrame& frame) {
  if (state.swapchain == XR_NULL_HANDLE || state.width != frame.width || state.height != frame.height) {
    if (!createOverlayResources(state, frame.width, frame.height)) return false;
  }
  if (state.uploadedSequence == frame.sequence) return true;
  XrSwapchainImageAcquireInfo acquireInfo{XR_TYPE_SWAPCHAIN_IMAGE_ACQUIRE_INFO};
  std::uint32_t index = 0;
  if (XR_FAILED(gDispatch.acquireSwapchainImage(state.swapchain, &acquireInfo, &index))) return false;
  XrSwapchainImageWaitInfo waitInfo{XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO};
  waitInfo.timeout = XR_INFINITE_DURATION;
  if (XR_FAILED(gDispatch.waitSwapchainImage(state.swapchain, &waitInfo))) return false;
  if (index >= state.images.size() || !state.images[index].texture) return false;
  state.context->UpdateSubresource(state.images[index].texture, 0, nullptr, preparePixels(state, frame), frame.stride, 0);
  XrSwapchainImageReleaseInfo releaseInfo{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
  if (XR_FAILED(gDispatch.releaseSwapchainImage(state.swapchain, &releaseInfo))) return false;
  state.uploadedSequence = frame.sequence;
  return true;
}

XrVector3f rotateVector(const XrQuaternionf& q, const XrVector3f& value) {
  const XrVector3f u{q.x, q.y, q.z};
  const float dotUv = u.x * value.x + u.y * value.y + u.z * value.z;
  const float dotUu = u.x * u.x + u.y * u.y + u.z * u.z;
  const XrVector3f cross{
    u.y * value.z - u.z * value.y,
    u.z * value.x - u.x * value.z,
    u.x * value.y - u.y * value.x,
  };
  return {
    2.0F * dotUv * u.x + (q.w * q.w - dotUu) * value.x + 2.0F * q.w * cross.x,
    2.0F * dotUv * u.y + (q.w * q.w - dotUu) * value.y + 2.0F * q.w * cross.y,
    2.0F * dotUv * u.z + (q.w * q.w - dotUu) * value.z + 2.0F * q.w * cross.z,
  };
}

XrQuaternionf normalizeQuaternion(const XrQuaternionf& q) {
  const float length = std::sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (length <= 0.000001F) return {0.0F, 0.0F, 0.0F, 1.0F};
  return {q.x / length, q.y / length, q.z / length, q.w / length};
}

XrQuaternionf multiplyQuaternion(const XrQuaternionf& left, const XrQuaternionf& right) {
  return normalizeQuaternion({
    left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
  });
}

XrQuaternionf axisAngleQuaternion(const XrVector3f& axis, float angle) {
  const float half = angle * 0.5F;
  const float sine = std::sin(half);
  return normalizeQuaternion({axis.x * sine, axis.y * sine, axis.z * sine, std::cos(half)});
}

struct YawPitch {
  float yaw = 0.0F;
  float pitch = 0.0F;
};

YawPitch extractYawPitch(const XrQuaternionf& orientation) {
  const XrQuaternionf normalized = normalizeQuaternion(orientation);
  const XrVector3f forward = rotateVector(normalized, {0.0F, 0.0F, -1.0F});
  const float horizontalLength = std::sqrt(forward.x * forward.x + forward.z * forward.z);
  float yaw = 0.0F;
  if (horizontalLength > 0.0001F) {
    yaw = std::atan2(-forward.x, -forward.z);
  } else {
    const XrVector3f right = rotateVector(normalized, {1.0F, 0.0F, 0.0F});
    yaw = std::atan2(-right.z, right.x);
  }
  const float pitch = std::asin(std::clamp(forward.y, -1.0F, 1.0F));
  return {yaw, pitch};
}

XrQuaternionf yawPitchQuaternion(float yaw, float pitch) {
  const XrQuaternionf yawRotation = axisAngleQuaternion({0.0F, 1.0F, 0.0F}, yaw);
  const XrQuaternionf pitchRotation = axisAngleQuaternion({1.0F, 0.0F, 0.0F}, pitch);
  return multiplyQuaternion(yawRotation, pitchRotation);
}

XrQuaternionf stabilizeHeadRoll(const XrQuaternionf& orientation) {
  const YawPitch angles = extractYawPitch(orientation);
  return yawPitchQuaternion(angles.yaw, angles.pitch);
}

bool updateRecenterPose(SessionState& state, const SharedFrame& frame, XrTime displayTime) {
  if (state.recenterValid && state.appliedRecenterSequence == frame.recenterSequence) return true;
  if (!ensureReferenceSpaces(state)) return false;
  XrSpaceLocation location{XR_TYPE_SPACE_LOCATION};
  const XrResult result = gDispatch.locateSpace(state.viewSpace, state.localSpace, displayTime, &location);
  constexpr XrSpaceLocationFlags required = XR_SPACE_LOCATION_POSITION_VALID_BIT | XR_SPACE_LOCATION_ORIENTATION_VALID_BIT;
  if (XR_FAILED(result) || (location.locationFlags & required) != required) return false;
  state.recenterPose = location.pose;
  state.recenterPose.orientation = stabilizeHeadRoll(location.pose.orientation);
  state.appliedRecenterSequence = frame.recenterSequence;
  state.recenterValid = true;
  logLine("Super Manual RECENTER anchor updated in LOCAL space with roll stabilization");
  return true;
}

XrPosef overlayPose(const SessionState& state, const SharedFrame& frame) {
  XrPosef pose = state.recenterPose;
  const YawPitch anchor = extractYawPitch(state.recenterPose.orientation);
  const float orbitYaw = std::clamp(frame.orbitYawRadians, -1.134464F, 1.134464F);
  const float orbitPitch = std::clamp(frame.orbitPitchRadians, -0.610865F, 0.610865F);
  const float yaw = anchor.yaw - orbitYaw;
  const float pitch = std::clamp(anchor.pitch + orbitPitch, -1.483530F, 1.483530F);
  pose.orientation = yawPitchQuaternion(yaw, pitch);
  const XrVector3f worldOffset = rotateVector(pose.orientation, {
    0.0F,
    0.0F,
    -std::clamp(frame.distanceMeters, 0.35F, 3.0F),
  });
  pose.position.x += worldOffset.x;
  pose.position.y += worldOffset.y;
  pose.position.z += worldOffset.z;
  return pose;
}

XRAPI_ATTR XrResult XRAPI_CALL layerDestroyInstance(XrInstance instance);
XRAPI_ATTR XrResult XRAPI_CALL layerCreateSession(XrInstance instance, const XrSessionCreateInfo* createInfo, XrSession* session);
XRAPI_ATTR XrResult XRAPI_CALL layerDestroySession(XrSession session);
XRAPI_ATTR XrResult XRAPI_CALL layerEndFrame(XrSession session, const XrFrameEndInfo* frameEndInfo);

XRAPI_ATTR XrResult XRAPI_CALL layerGetInstanceProcAddr(XrInstance instance, const char* name, PFN_xrVoidFunction* function) {
  if (!name || !function) return XR_ERROR_VALIDATION_FAILURE;
  if (!gOverlayEnabled) {
    return gDispatch.getInstanceProcAddr ? gDispatch.getInstanceProcAddr(instance, name, function) : XR_ERROR_FUNCTION_UNSUPPORTED;
  }
  if (std::string_view(name) == "xrGetInstanceProcAddr") *function = reinterpret_cast<PFN_xrVoidFunction>(layerGetInstanceProcAddr);
  else if (std::string_view(name) == "xrDestroyInstance") *function = reinterpret_cast<PFN_xrVoidFunction>(layerDestroyInstance);
  else if (std::string_view(name) == "xrCreateSession") *function = reinterpret_cast<PFN_xrVoidFunction>(layerCreateSession);
  else if (std::string_view(name) == "xrDestroySession") *function = reinterpret_cast<PFN_xrVoidFunction>(layerDestroySession);
  else if (std::string_view(name) == "xrEndFrame") *function = reinterpret_cast<PFN_xrVoidFunction>(layerEndFrame);
  else return gDispatch.getInstanceProcAddr ? gDispatch.getInstanceProcAddr(instance, name, function) : XR_ERROR_FUNCTION_UNSUPPORTED;
  return XR_SUCCESS;
}

XRAPI_ATTR XrResult XRAPI_CALL layerCreateApiLayerInstance(
  const XrInstanceCreateInfo* info,
  const XrApiLayerCreateInfo* apiLayerInfo,
  XrInstance* instance) {
  if (!info || !apiLayerInfo || !apiLayerInfo->nextInfo || !instance ||
      apiLayerInfo->structType != XR_LOADER_INTERFACE_STRUCT_API_LAYER_CREATE_INFO ||
      apiLayerInfo->nextInfo->structType != XR_LOADER_INTERFACE_STRUCT_API_LAYER_NEXT_INFO ||
      std::strcmp(apiLayerInfo->nextInfo->layerName, kLayerName) != 0 ||
      !apiLayerInfo->nextInfo->nextGetInstanceProcAddr || !apiLayerInfo->nextInfo->nextCreateApiLayerInstance) {
    return XR_ERROR_INITIALIZATION_FAILED;
  }
  XrApiLayerCreateInfo nextInfo = *apiLayerInfo;
  nextInfo.nextInfo = apiLayerInfo->nextInfo->next;
  gDispatch.getInstanceProcAddr = apiLayerInfo->nextInfo->nextGetInstanceProcAddr;
  const XrResult result = apiLayerInfo->nextInfo->nextCreateApiLayerInstance(info, &nextInfo, instance);
  if (XR_FAILED(result)) return result;
  std::scoped_lock lock(gMutex);
  gInstance = *instance;
  gOverlayEnabled = isDcsProcess();
  if (!gOverlayEnabled) return result;
  if (!populateDispatch(gInstance)) return XR_ERROR_INITIALIZATION_FAILED;
  logLine("OpenXR API layer attached to application instance");
  return result;
}

XRAPI_ATTR XrResult XRAPI_CALL layerCreateSession(
  XrInstance instance,
  const XrSessionCreateInfo* createInfo,
  XrSession* session) {
  if (!gDispatch.createSession) return XR_ERROR_FUNCTION_UNSUPPORTED;
  const XrResult result = gDispatch.createSession(instance, createInfo, session);
  if (XR_FAILED(result) || !session || *session == XR_NULL_HANDLE) return result;
  const auto* binding = findD3D11Binding(createInfo ? createInfo->next : nullptr);
  if (!binding || !binding->device) {
    logLine("OpenXR session is not using D3D11; overlay is unavailable for this session");
    return result;
  }
  auto state = std::make_unique<SessionState>();
  state->session = *session;
  state->device = binding->device;
  state->device->AddRef();
  state->device->GetImmediateContext(&state->context);
  std::scoped_lock lock(gMutex);
  gSessions[*session] = std::move(state);
  logLine("OpenXR D3D11 session detected");
  return result;
}

XRAPI_ATTR XrResult XRAPI_CALL layerDestroySession(XrSession session) {
  {
    std::scoped_lock lock(gMutex);
    const auto found = gSessions.find(session);
    if (found != gSessions.end()) {
      destroySwapchain(*found->second);
      if (found->second->viewSpace != XR_NULL_HANDLE && gDispatch.destroySpace) gDispatch.destroySpace(found->second->viewSpace);
      if (found->second->localSpace != XR_NULL_HANDLE && gDispatch.destroySpace) gDispatch.destroySpace(found->second->localSpace);
      gSessions.erase(found);
    }
  }
  return gDispatch.destroySession ? gDispatch.destroySession(session) : XR_ERROR_FUNCTION_UNSUPPORTED;
}

XRAPI_ATTR XrResult XRAPI_CALL layerEndFrame(XrSession session, const XrFrameEndInfo* frameEndInfo) {
  if (!gDispatch.endFrame || !frameEndInfo) return XR_ERROR_VALIDATION_FAILURE;
  std::scoped_lock lock(gMutex);
  const auto found = gSessions.find(session);
  if (found == gSessions.end()) return gDispatch.endFrame(session, frameEndInfo);

  SharedFrame frame;
  if (!gSharedReader.read(frame) || !frame.active || frame.pixels.empty() || !uploadFrame(*found->second, frame)) {
    return gDispatch.endFrame(session, frameEndInfo);
  }
  if (!updateRecenterPose(*found->second, frame, frameEndInfo->displayTime)) {
    return gDispatch.endFrame(session, frameEndInfo);
  }

  XrCompositionLayerQuad overlay{XR_TYPE_COMPOSITION_LAYER_QUAD};
  overlay.layerFlags = XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT;
  overlay.space = found->second->localSpace;
  overlay.eyeVisibility = XR_EYE_VISIBILITY_BOTH;
  overlay.subImage.swapchain = found->second->swapchain;
  overlay.subImage.imageRect.extent = {static_cast<std::int32_t>(frame.width), static_cast<std::int32_t>(frame.height)};
  overlay.pose = overlayPose(*found->second, frame);
  overlay.size.width = std::clamp(frame.widthMeters, 0.3F, 2.0F);
  overlay.size.height = std::clamp(frame.heightMeters, 0.3F, 1.5F);

  std::vector<const XrCompositionLayerBaseHeader*> layers;
  layers.reserve(frameEndInfo->layerCount + 1);
  for (std::uint32_t index = 0; index < frameEndInfo->layerCount; ++index) layers.push_back(frameEndInfo->layers[index]);
  layers.push_back(reinterpret_cast<const XrCompositionLayerBaseHeader*>(&overlay));
  XrFrameEndInfo next = *frameEndInfo;
  next.layerCount = static_cast<std::uint32_t>(layers.size());
  next.layers = layers.data();
  if (!found->second->firstFrameLogged) {
    found->second->firstFrameLogged = true;
    logLine("First Super Manual frame submitted to OpenXR");
  }
  const XrResult result = gDispatch.endFrame(session, &next);
  if (XR_FAILED(result) && !found->second->submissionFailureLogged) {
    found->second->submissionFailureLogged = true;
    logLine("OpenXR runtime rejected the Super Manual composition layer");
  }
  return result;
}

XRAPI_ATTR XrResult XRAPI_CALL layerDestroyInstance(XrInstance instance) {
  std::scoped_lock lock(gMutex);
  gSessions.clear();
  const auto destroy = gDispatch.destroyInstance;
  gInstance = XR_NULL_HANDLE;
  gOverlayEnabled = false;
  return destroy ? destroy(instance) : XR_ERROR_FUNCTION_UNSUPPORTED;
}

} // namespace

extern "C" LAYER_EXPORT int DcsHubRunPoseMathSelfTest() {
  constexpr float epsilon = 0.001F;
  const XrQuaternionf rollOnly = axisAngleQuaternion({0.0F, 0.0F, 1.0F}, 0.523599F);
  const XrQuaternionf stabilized = stabilizeHeadRoll(rollOnly);
  if (std::abs(stabilized.x) > epsilon || std::abs(stabilized.y) > epsilon ||
      std::abs(stabilized.z) > epsilon || std::abs(std::abs(stabilized.w) - 1.0F) > epsilon) return 1;

  SessionState state;
  state.recenterPose.orientation = {0.0F, 0.0F, 0.0F, 1.0F};
  state.recenterPose.position = {0.0F, 0.0F, 0.0F};
  SharedFrame rightFrame;
  rightFrame.distanceMeters = 1.0F;
  rightFrame.orbitYawRadians = 1.134464F;
  const XrPosef rightPose = overlayPose(state, rightFrame);
  const float rightDistance = std::sqrt(
    rightPose.position.x * rightPose.position.x + rightPose.position.y * rightPose.position.y +
    rightPose.position.z * rightPose.position.z);
  if (std::abs(rightDistance - 1.0F) > epsilon || rightPose.position.x <= 0.0F || rightPose.position.z >= 0.0F) return 2;
  const XrVector3f panelNormal = rotateVector(rightPose.orientation, {0.0F, 0.0F, 1.0F});
  const float facingDot = panelNormal.x * -rightPose.position.x + panelNormal.y * -rightPose.position.y +
    panelNormal.z * -rightPose.position.z;
  if (facingDot < 0.999F) return 3;

  SharedFrame upperFrame;
  upperFrame.distanceMeters = 1.0F;
  upperFrame.orbitPitchRadians = 0.610865F;
  const XrPosef upperPose = overlayPose(state, upperFrame);
  if (upperPose.position.y <= 0.0F || upperPose.position.z >= 0.0F) return 4;
  return 0;
}

extern "C" LAYER_EXPORT XRAPI_ATTR XrResult XRAPI_CALL xrNegotiateLoaderApiLayerInterface(
  const XrNegotiateLoaderInfo* loaderInfo,
  const char*,
  XrNegotiateApiLayerRequest* request) {
  if (!loaderInfo || !request ||
      loaderInfo->structType != XR_LOADER_INTERFACE_STRUCT_LOADER_INFO ||
      request->structType != XR_LOADER_INTERFACE_STRUCT_API_LAYER_REQUEST ||
      loaderInfo->minInterfaceVersion > XR_CURRENT_LOADER_API_LAYER_VERSION ||
      loaderInfo->maxInterfaceVersion < XR_CURRENT_LOADER_API_LAYER_VERSION) {
    return XR_ERROR_INITIALIZATION_FAILED;
  }
  request->layerInterfaceVersion = XR_CURRENT_LOADER_API_LAYER_VERSION;
  request->layerApiVersion = std::min(loaderInfo->maxApiVersion, XR_CURRENT_API_VERSION);
  request->getInstanceProcAddr = layerGetInstanceProcAddr;
  request->createApiLayerInstance = layerCreateApiLayerInstance;
  return XR_SUCCESS;
}
