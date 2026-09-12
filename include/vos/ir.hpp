#pragma once
#include "semantic.hpp"
namespace vos {
struct IRFunction { std::string name,returnType; bool pure=false; std::vector<std::pair<std::string,std::string>> params; std::vector<Token> body; std::set<std::string> effects; };
struct IRModule { std::string name,version,architecture,domain,sourceHash; HardwareModel hardware; std::vector<IRFunction> functions; std::vector<Decl> metadataDecls; };
class Lowerer { public: IRModule lower(const SemanticModel&); };
class Optimizer { public: void optimize(IRModule&,int level); };
std::string irToJson(const IRModule&);
}
