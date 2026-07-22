#include "shared_protocol.h"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <algorithm>
#include <cstring>
#include <iostream>
#include <vector>

namespace {

bool readExact(HANDLE input, void* destination, DWORD size) {
  auto* output = static_cast<std::uint8_t*>(destination);
  DWORD completed = 0;
  while (completed < size) {
    DWORD received = 0;
    if (!ReadFile(input, output + completed, size - completed, &received, nullptr) || received == 0) return false;
    completed += received;
  }
  return true;
}

void publishInactive(dcshub::vr::SharedOverlayHeader* shared, HANDLE mutex) {
  if (WaitForSingleObject(mutex, 500) != WAIT_OBJECT_0) return;
  shared->active = 0;
  shared->sequence += 1;
  ReleaseMutex(mutex);
}

int selfTest() {
  dcshub::vr::FramePacketHeader packet{
    dcshub::vr::kPacketMagic, 2, 2, 8, 16, 1, 1.2F, 0.8F, 1.0F, 0.0F, 0.0F, 1,
  };
  return packet.dataSize == packet.stride * packet.height ? 0 : 1;
}

int probeSharedFrame() {
  HANDLE mutex = OpenMutexA(SYNCHRONIZE | MUTEX_MODIFY_STATE, FALSE, dcshub::vr::kMutexName);
  HANDLE mapping = OpenFileMappingA(FILE_MAP_READ, FALSE, dcshub::vr::kMappingName);
  if (!mutex || !mapping) {
    if (mapping) CloseHandle(mapping);
    if (mutex) CloseHandle(mutex);
    return 5;
  }
  const auto* view = static_cast<const std::uint8_t*>(MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0));
  if (!view) {
    CloseHandle(mapping);
    CloseHandle(mutex);
    return 6;
  }
  int result = 7;
  if (WaitForSingleObject(mutex, 1'000) == WAIT_OBJECT_0) {
    const auto* header = reinterpret_cast<const dcshub::vr::SharedOverlayHeader*>(view);
    result = header->magic == dcshub::vr::kSharedMagic && header->version == dcshub::vr::kSharedVersion &&
      header->active != 0 && header->width > 0 && header->height > 0 && header->sequence > 0 ? 0 : 8;
    ReleaseMutex(mutex);
  }
  UnmapViewOfFile(view);
  CloseHandle(mapping);
  CloseHandle(mutex);
  return result;
}

} // namespace

int wmain(int argc, wchar_t** argv) {
  if (argc > 1 && std::wstring_view(argv[1]) == L"--self-test") return selfTest();
  if (argc > 1 && std::wstring_view(argv[1]) == L"--probe") return probeSharedFrame();

  const DWORD mappingSize = static_cast<DWORD>(sizeof(dcshub::vr::SharedOverlayHeader) + dcshub::vr::kMaxPixelBytes);
  HANDLE mutex = CreateMutexA(nullptr, FALSE, dcshub::vr::kMutexName);
  if (!mutex) return 2;
  HANDLE mapping = CreateFileMappingA(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0, mappingSize, dcshub::vr::kMappingName);
  if (!mapping) {
    CloseHandle(mutex);
    return 3;
  }
  auto* view = static_cast<std::uint8_t*>(MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, mappingSize));
  if (!view) {
    CloseHandle(mapping);
    CloseHandle(mutex);
    return 4;
  }

  auto* shared = reinterpret_cast<dcshub::vr::SharedOverlayHeader*>(view);
  auto* pixels = view + sizeof(dcshub::vr::SharedOverlayHeader);
  std::memset(view, 0, mappingSize);
  shared->magic = dcshub::vr::kSharedMagic;
  shared->version = dcshub::vr::kSharedVersion;
  shared->capacity = dcshub::vr::kMaxPixelBytes;
  shared->widthMeters = 1.2F;
  shared->heightMeters = 0.8F;
  shared->distanceMeters = 1.0F;

  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  std::vector<std::uint8_t> incoming;
  dcshub::vr::FramePacketHeader packet{};
  while (readExact(input, &packet, sizeof(packet))) {
    if (packet.magic != dcshub::vr::kPacketMagic) break;
    if (packet.dataSize > dcshub::vr::kMaxPixelBytes) break;
    incoming.resize(packet.dataSize);
    if (packet.dataSize > 0 && !readExact(input, incoming.data(), packet.dataSize)) break;

    if (WaitForSingleObject(mutex, 1'000) != WAIT_OBJECT_0) continue;
    const bool validFrame = packet.active != 0 && packet.width > 0 && packet.height > 0 &&
      packet.width <= dcshub::vr::kMaxWidth && packet.height <= dcshub::vr::kMaxHeight &&
      packet.stride >= packet.width * 4 && packet.dataSize == packet.stride * packet.height;
    if (validFrame) {
      shared->width = packet.width;
      shared->height = packet.height;
      shared->stride = packet.stride;
      shared->widthMeters = std::clamp(packet.widthMeters, 0.3F, 2.0F);
      shared->heightMeters = std::clamp(packet.heightMeters, 0.3F, 1.5F);
      shared->distanceMeters = std::clamp(packet.distanceMeters, 0.35F, 3.0F);
      shared->orbitYawRadians = std::clamp(packet.orbitYawRadians, -1.134464F, 1.134464F);
      shared->orbitPitchRadians = std::clamp(packet.orbitPitchRadians, -0.610865F, 0.610865F);
      shared->recenterSequence = packet.recenterSequence;
      std::memcpy(pixels, incoming.data(), packet.dataSize);
      shared->active = 1;
    } else {
      shared->active = 0;
    }
    shared->sequence += 1;
    ReleaseMutex(mutex);
  }

  publishInactive(shared, mutex);
  UnmapViewOfFile(view);
  CloseHandle(mapping);
  CloseHandle(mutex);
  return 0;
}
