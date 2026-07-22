#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <openxr/openxr.h>
#include <openxr/openxr_loader_negotiation.h>

#include <algorithm>
#include <cstring>
#include <vector>

namespace {

int discoverLayer(const wchar_t* loaderPath, const char* expectedLayerName) {
  HMODULE loader = LoadLibraryW(loaderPath);
  if (!loader) return 10;
  auto enumerate = reinterpret_cast<PFN_xrEnumerateApiLayerProperties>(
    GetProcAddress(loader, "xrEnumerateApiLayerProperties"));
  if (!enumerate) {
    FreeLibrary(loader);
    return 11;
  }
  uint32_t count = 0;
  XrResult result = enumerate(0, &count, nullptr);
  if (XR_FAILED(result)) {
    FreeLibrary(loader);
    return 12;
  }
  std::vector<XrApiLayerProperties> properties(count, { XR_TYPE_API_LAYER_PROPERTIES });
  result = enumerate(count, &count, properties.data());
  const bool found = XR_SUCCEEDED(result) && std::any_of(
    properties.begin(), properties.end(),
    [expectedLayerName](const XrApiLayerProperties& property) {
      return std::strcmp(property.layerName, expectedLayerName) == 0;
    });
  FreeLibrary(loader);
  return found ? 0 : 13;
}

int createInstance(const wchar_t* loaderPath) {
  HMODULE loader = LoadLibraryW(loaderPath);
  if (!loader) return 20;
  auto create = reinterpret_cast<PFN_xrCreateInstance>(GetProcAddress(loader, "xrCreateInstance"));
  auto destroy = reinterpret_cast<PFN_xrDestroyInstance>(GetProcAddress(loader, "xrDestroyInstance"));
  if (!create || !destroy) {
    FreeLibrary(loader);
    return 21;
  }
  XrInstanceCreateInfo createInfo{XR_TYPE_INSTANCE_CREATE_INFO};
  std::strncpy(createInfo.applicationInfo.applicationName, "DCSHUB OpenXR Probe", XR_MAX_APPLICATION_NAME_SIZE - 1);
  std::strncpy(createInfo.applicationInfo.engineName, "DCSHUB", XR_MAX_ENGINE_NAME_SIZE - 1);
  createInfo.applicationInfo.applicationVersion = 1;
  createInfo.applicationInfo.engineVersion = 1;
  createInfo.applicationInfo.apiVersion = XR_MAKE_VERSION(1, 0, 0);
  XrInstance instance = XR_NULL_HANDLE;
  const XrResult result = create(&createInfo, &instance);
  if (XR_SUCCEEDED(result) && instance != XR_NULL_HANDLE) destroy(instance);
  FreeLibrary(loader);
  return XR_SUCCEEDED(result) ? 0 : 22;
}

} // namespace

int wmain(int argc, wchar_t** argv) {
  if (argc == 4 && wcscmp(argv[1], L"--discover") == 0) {
    char expectedLayerName[XR_MAX_API_LAYER_NAME_SIZE]{};
    const int converted = WideCharToMultiByte(
      CP_UTF8, 0, argv[3], -1, expectedLayerName, XR_MAX_API_LAYER_NAME_SIZE, nullptr, nullptr);
    if (converted <= 0) return 14;
    return discoverLayer(argv[2], expectedLayerName);
  }
  if (argc == 3 && wcscmp(argv[1], L"--create") == 0) return createInstance(argv[2]);
  if (argc != 2) return 2;
  HMODULE library = LoadLibraryW(argv[1]);
  if (!library) return 3;
  auto negotiate = reinterpret_cast<PFN_xrNegotiateLoaderApiLayerInterface>(
    GetProcAddress(library, "xrNegotiateLoaderApiLayerInterface"));
  auto poseMathSelfTest = reinterpret_cast<int (*)()>(GetProcAddress(library, "DcsHubRunPoseMathSelfTest"));
  if (!negotiate || !poseMathSelfTest) {
    FreeLibrary(library);
    return 4;
  }
  if (poseMathSelfTest() != 0) {
    FreeLibrary(library);
    return 6;
  }
  XrNegotiateLoaderInfo loader{};
  loader.structType = XR_LOADER_INTERFACE_STRUCT_LOADER_INFO;
  loader.structVersion = XR_LOADER_INFO_STRUCT_VERSION;
  loader.structSize = sizeof(loader);
  loader.minInterfaceVersion = 1;
  loader.maxInterfaceVersion = XR_CURRENT_LOADER_API_LAYER_VERSION;
  loader.minApiVersion = XR_MAKE_VERSION(1, 0, 0);
  loader.maxApiVersion = XR_CURRENT_API_VERSION;
  XrNegotiateApiLayerRequest request{};
  request.structType = XR_LOADER_INTERFACE_STRUCT_API_LAYER_REQUEST;
  request.structVersion = XR_API_LAYER_INFO_STRUCT_VERSION;
  request.structSize = sizeof(request);
  const XrResult result = negotiate(&loader, "XR_APILAYER_DCSHUB_manual_overlay", &request);
  const bool valid = XR_SUCCEEDED(result) && request.getInstanceProcAddr && request.createApiLayerInstance &&
    request.layerInterfaceVersion == XR_CURRENT_LOADER_API_LAYER_VERSION;
  FreeLibrary(library);
  return valid ? 0 : 5;
}
