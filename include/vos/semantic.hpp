#pragma once
#include "ast.hpp"
namespace vos {
struct TypeRef { std::string text; int bits=0; bool isSigned=false; bool isAddress=false; std::string addressSpace; };
struct MemoryRegion { std::string name; uint64_t address=0,size=0,alignment=1; std::string permissions="rw-", cache="default", mapping; Span span; };
struct RegisterDef { std::string name,type; uint64_t offset=0,reset=0; std::string access="rw"; bool isVolatile=false; };
struct DeviceDef { std::string name; uint64_t mmioBase=0,mmioSize=0; std::vector<RegisterDef> registers; };
struct HardwareComponent { std::string kind,name; std::map<std::string,std::string> properties; };
struct HardwareModel { std::string name="VOSMachine", architecture="V74"; std::vector<HardwareComponent> components; std::vector<MemoryRegion> regions; std::vector<DeviceDef> devices; };
struct ProcInfo { std::string name,returnType="void"; bool pure=false; std::vector<std::pair<std::string,std::string>> params; std::set<std::string> effects; std::vector<Token> body; Span span; };
struct SemanticModel { Program program; std::string domain="safe"; HardwareModel hw; std::vector<ProcInfo> procs; std::vector<Diagnostic> diagnostics; std::set<std::string> imports; };
class SemanticAnalyzer {
 public: SemanticModel analyze(Program p);
 private: SemanticModel m_; void diag(Diagnostic::Level,std::string,std::string,const Span&); void analyzeDecl(const Decl&); void analyzeHardware(const Decl&); void analyzeComptime(const Decl&); void analyzeMemory(const Decl&); void analyzeDevice(const Decl&); void analyzeProc(const Decl&); void analyzeOwnershipAndEffects(ProcInfo&); static uint64_t parseQuantity(const std::vector<Token>&,size_t&,bool*ok=nullptr); static std::string joinRange(const std::vector<Token>&,size_t,size_t); static TypeRef parseTypeText(std::string); void validateRegions();
};
}
