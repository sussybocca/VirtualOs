#pragma once
#include "lexer.hpp"
namespace vos {
enum class DeclKind { Domain, Unit, Import, Hardware, MemorySpace, Device, Shared, Interrupt, Procedure, Driver, Process, Task, Channel, State, Machine, Isa, Target, Comptime, Assembly, Unknown };
inline std::string declKindName(DeclKind k){switch(k){case DeclKind::Domain:return"domain";case DeclKind::Unit:return"unit";case DeclKind::Import:return"import";case DeclKind::Hardware:return"hardware";case DeclKind::MemorySpace:return"memoryspace";case DeclKind::Device:return"device";case DeclKind::Shared:return"shared";case DeclKind::Interrupt:return"interrupt";case DeclKind::Procedure:return"proc";case DeclKind::Driver:return"driver";case DeclKind::Process:return"process";case DeclKind::Task:return"task";case DeclKind::Channel:return"channel";case DeclKind::State:return"state";case DeclKind::Machine:return"machine";case DeclKind::Isa:return"isa";case DeclKind::Target:return"target";case DeclKind::Comptime:return"comptime";case DeclKind::Assembly:return"asm";default:return"unknown";}}
struct Decl { DeclKind kind=DeclKind::Unknown; std::string name; std::vector<Token> header; std::vector<Token> body; Span span; };
struct Program { std::string file; std::string vosVersion; std::vector<Decl> decls; std::vector<Diagnostic> diagnostics; };
}
