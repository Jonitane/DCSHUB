cmake_minimum_required(VERSION 3.20)
project(DcsHubVrOverlay LANGUAGES CXX)

include(FetchContent)
if(POLICY CMP0169)
  cmake_policy(SET CMP0169 OLD)
endif()
FetchContent_Declare(
  openxr_sdk
  GIT_REPOSITORY https://github.com/KhronosGroup/OpenXR-SDK.git
  GIT_TAG release-1.1.52
  GIT_SHALLOW TRUE
)
FetchContent_GetProperties(openxr_sdk)
if(NOT openxr_sdk_POPULATED)
  FetchContent_Populate(openxr_sdk)
endif()

add_library(DcsHubOpenXrLayer SHARED layer.cpp shared_protocol.h)
target_compile_features(DcsHubOpenXrLayer PRIVATE cxx_std_17)
target_compile_definitions(DcsHubOpenXrLayer PRIVATE NOMINMAX)
target_include_directories(DcsHubOpenXrLayer PRIVATE ${openxr_sdk_SOURCE_DIR}/include)
target_link_libraries(DcsHubOpenXrLayer PRIVATE d3d11 dxgi advapi32)

add_executable(DcsHubVrBridge bridge.cpp shared_protocol.h)
target_compile_features(DcsHubVrBridge PRIVATE cxx_std_17)
target_compile_definitions(DcsHubVrBridge PRIVATE NOMINMAX)

add_executable(DcsHubLayerProbe layer_probe.cpp)
target_compile_features(DcsHubLayerProbe PRIVATE cxx_std_17)
target_include_directories(DcsHubLayerProbe PRIVATE ${openxr_sdk_SOURCE_DIR}/include)

set_target_properties(DcsHubOpenXrLayer DcsHubVrBridge DcsHubLayerProbe PROPERTIES
  MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/out"
  LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/out"
)

add_custom_command(TARGET DcsHubOpenXrLayer POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    "${CMAKE_CURRENT_SOURCE_DIR}/DCSHUBManualOverlayLayer.json"
    "$<TARGET_FILE_DIR:DcsHubOpenXrLayer>/DCSHUBManualOverlayLayer.json"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    "${CMAKE_CURRENT_SOURCE_DIR}/THIRD_PARTY_NOTICES.md"
    "$<TARGET_FILE_DIR:DcsHubOpenXrLayer>/THIRD_PARTY_NOTICES.md"
)
