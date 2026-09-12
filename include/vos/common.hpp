#pragma once
#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <optional>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <variant>
#include <vector>

namespace vos {
struct Span { std::string file; int line=1, column=1, endLine=1, endColumn=1; };
struct Diagnostic {
  enum class Level { Note, Warning, Error } level = Level::Error;
  std::string code, message; Span span;
};
inline std::string levelName(Diagnostic::Level l) {
  switch(l){case Diagnostic::Level::Note:return "note";case Diagnostic::Level::Warning:return "warning";default:return "error";}
}
inline std::string readText(const std::filesystem::path& p){ std::ifstream f(p,std::ios::binary); if(!f) throw std::runtime_error("cannot open "+p.string()); return {std::istreambuf_iterator<char>(f),{}}; }
inline void writeText(const std::filesystem::path& p,const std::string& s){ std::filesystem::create_directories(p.parent_path()); std::ofstream f(p,std::ios::binary); if(!f) throw std::runtime_error("cannot write "+p.string()); f<<s; }
inline void writeBytes(const std::filesystem::path& p,const std::vector<uint8_t>& s){ std::filesystem::create_directories(p.parent_path()); std::ofstream f(p,std::ios::binary); if(!f) throw std::runtime_error("cannot write "+p.string()); f.write((const char*)s.data(),(std::streamsize)s.size()); }
inline std::string jsonEscape(std::string_view s){ std::ostringstream o; o<<'"'; for(unsigned char c:s){ switch(c){case '"':o<<"\\\"";break;case '\\':o<<"\\\\";break;case '\n':o<<"\\n";break;case '\r':o<<"\\r";break;case '\t':o<<"\\t";break;default: if(c<32)o<<"\\u"<<std::hex<<std::setw(4)<<std::setfill('0')<<(int)c<<std::dec;else o<<(char)c;}} o<<'"'; return o.str(); }
inline uint64_t fnv1a64(std::string_view s){ uint64_t h=1469598103934665603ULL; for(unsigned char c:s){h^=c;h*=1099511628211ULL;} return h; }
inline std::string hex64(uint64_t v){ std::ostringstream o;o<<std::hex<<std::setw(16)<<std::setfill('0')<<v;return o.str(); }
}
