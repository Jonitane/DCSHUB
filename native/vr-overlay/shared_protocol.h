#pragma once

#include <cstdint>

namespace dcshub::vr {

constexpr std::uint32_t kSharedMagic = 0x42554844; // "DHUB"
constexpr std::uint32_t kSharedVersion = 3;
constexpr std::uint32_t kPacketMagic = 0x4D415246; // "FRAM"
constexpr std::uint32_t kMaxWidth = 1920;
constexpr std::uint32_t kMaxHeight = 1080;
constexpr std::uint32_t kMaxPixelBytes = kMaxWidth * kMaxHeight * 4;
constexpr char kMappingName[] = "Local\\DCSHUBManualOverlaySHM";
constexpr char kMutexName[] = "Local\\DCSHUBManualOverlayMutex";

#pragma pack(push, 1)
struct SharedOverlayHeader {
  std::uint32_t magic;
  std::uint32_t version;
  std::uint32_t capacity;
  std::uint32_t width;
  std::uint32_t height;
  std::uint32_t stride;
  std::uint32_t sequence;
  std::uint32_t active;
  float widthMeters;
  float heightMeters;
  float distanceMeters;
  float orbitYawRadians;
  float orbitPitchRadians;
  std::uint32_t recenterSequence;
  std::uint32_t reserved[2];
};

struct FramePacketHeader {
  std::uint32_t magic;
  std::uint32_t width;
  std::uint32_t height;
  std::uint32_t stride;
  std::uint32_t dataSize;
  std::uint32_t active;
  float widthMeters;
  float heightMeters;
  float distanceMeters;
  float orbitYawRadians;
  float orbitPitchRadians;
  std::uint32_t recenterSequence;
};
#pragma pack(pop)

static_assert(sizeof(SharedOverlayHeader) == 64);
static_assert(sizeof(FramePacketHeader) == 48);

} // namespace dcshub::vr
