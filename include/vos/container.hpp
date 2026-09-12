#pragma once
#include "common.hpp"
namespace vos {
struct Section { std::string name; std::vector<uint8_t> data; };
std::vector<uint8_t> makeContainer(std::string magic,uint16_t major,uint16_t minor,const std::vector<Section>& sections);
std::string containerInfo(const std::vector<uint8_t>& bytes);
}
