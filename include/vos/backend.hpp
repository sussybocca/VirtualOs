#pragma once
#include "ir.hpp"
#include "container.hpp"
namespace vos {
struct BuildProducts { std::string manifest,js,debugJson,libraryJson; std::vector<uint8_t> wasm,asmV74,vhw,vimg,vxe,vlib,vdbg; std::vector<Diagnostic> diagnostics; };
class Backend {
 public: BuildProducts build(const IRModule&,int optimizeLevel=2);
 private: std::string emitManifest(const IRModule&); std::string emitJS(const IRModule&,std::vector<Diagnostic>&); std::vector<uint8_t> emitWasm(const IRModule&,std::set<std::string>& exported,std::vector<Diagnostic>&); std::string emitDebug(const IRModule&); std::string emitLibrary(const IRModule&); std::vector<uint8_t> assembleV74(const IRModule&,std::vector<Diagnostic>&); std::string transpileBody(const std::vector<Token>&,const std::string&,std::vector<Diagnostic>&); std::string transpileExpression(const std::vector<Token>&,size_t,size_t); std::string numberToJS(std::string); };
}
