#include "vos/lexer.hpp"
#include "vos/parser.hpp"
#include "vos/semantic.hpp"
#include "vos/ir.hpp"
#include "vos/backend.hpp"
#include "vos/container.hpp"

namespace fs=std::filesystem;
using namespace vos;
static void printDiag(const Diagnostic&d){std::cerr<<d.span.file<<":"<<d.span.line<<":"<<d.span.column<<": "<<levelName(d.level)<<"["<<d.code<<"] "<<d.message<<"\n";}
static bool hasErrors(const std::vector<Diagnostic>&d){return std::any_of(d.begin(),d.end(),[](auto&x){return x.level==Diagnostic::Level::Error;});}
static void usage(){std::cout<<R"(VOS Toolchain 0.3
Usage:
  vos new <directory>
  vos check <file.vos>
  vos build <file.vos> [-o DIR] [--opt 0|1|2|3]
  vos emit-ir <file.vos>
  vos inspect <file.vxe|file.vimg|file.vhw|file.vlib|file.vdbg>
  vos --version

Build products: manifest.json, module.js, module.wasm, .vxe, .vimg, .vhw, .vlib, .vdbg
)";}
struct CompileResult{SemanticModel sem;IRModule ir;};
static CompileResult compileFront(const fs::path&p){auto src=readText(p);Lexer lx(p.string(),src);auto tok=lx.lex();for(auto&d:lx.diagnostics())printDiag(d);Parser ps(p.string(),std::move(tok));auto ast=ps.parse();SemanticAnalyzer sa;auto sem=sa.analyze(std::move(ast));Lowerer lo;auto ir=lo.lower(sem);return{std::move(sem),std::move(ir)};}
int main(int argc,char**argv){try{if(argc<2){usage();return 1;}std::string cmd=argv[1];if(cmd=="--version"||cmd=="version"){std::cout<<"VOS Compiler 0.3.0 (VOS ABI 1)\n";return 0;}if(cmd=="new"){if(argc<3)throw std::runtime_error("new requires a directory");fs::path dir=argv[2];fs::create_directories(dir);std::string starter=R"VOS(@vos 1.0;
@domain kernel;

unit os::starter {
  identity { name = "StarterOS"; version = 0.1.0; architecture = vos74; abi = vosabi::1; }
  compile { safety = strict; bounds = checked; overflow = trap; nullability = forbidden; optimization = aggressive; }
}

hardware machine StarterMachine {
  architecture V74;
  cpu BSP { isa = V74; clock = 2.50GHz; registers = 32; }
  memory RAM { capacity = 512MiB; page = 4KiB; endian = little; }
  gpu DisplayGPU { architecture = VGPU2; vram = 64MiB; queues = 2; displays = 1; }
}

memoryspace system : physical<74> {
  region Kernel @ 0x0010_0000 size 16MiB permissions r-x alignment 4096;
  region Heap @ 0x0200_0000 size 64MiB permissions rw- alignment 4096;
  region FrameBuffer @ 0x1000_0000 size 16MiB permissions rw- alignment 4096 mapping device::Display;
}

device Display {
  mmio REGS @ 0x1F00_0000 size 64KiB {
    register CONTROL : u32 @ +0x0000 access rw reset 0;
    register WIDTH : u32 @ +0x0008 access rw reset 1280;
    register HEIGHT : u32 @ +0x000C access rw reset 720;
    register FRAME_ADDR : u74 @ +0x0010 access rw reset 0;
  }
}

proc kernel_main(boot: u32) -> u32
effects { mmio.write; }
contract { requires boot == boot; }
{
  Display.FRAME_ADDR <- 0x1000_0000u74;
  Display.CONTROL <- 1u32;
  return 0u32;
}
)VOS";writeText(dir/"main.vos",starter);writeText(dir/"build.cmd","@echo off\r\n..\\build\\vos.exe build main.vos -o dist --opt 3\r\n");writeText(dir/"README.txt","Build with: ..\\build\\vos.exe build main.vos -o dist --opt 3\r\n");std::cout<<"VOS: created project "<<dir.string()<<"\n";return 0;}if(cmd=="inspect"){if(argc<3)throw std::runtime_error("inspect requires a file");std::ifstream f(argv[2],std::ios::binary);std::vector<uint8_t>b((std::istreambuf_iterator<char>(f)),{});std::cout<<containerInfo(b);return 0;}if(cmd!="check"&&cmd!="build"&&cmd!="emit-ir"){usage();return 1;}if(argc<3)throw std::runtime_error(cmd+" requires a .vos source file");fs::path src=argv[2];auto c=compileFront(src);for(auto&d:c.sem.diagnostics)printDiag(d);if(hasErrors(c.sem.diagnostics)){std::cerr<<"VOS: compilation stopped due to semantic errors\n";return 2;}if(cmd=="check"){std::cout<<"VOS: "<<src.string()<<" is valid ("<<c.sem.procs.size()<<" procedures, "<<c.sem.hw.regions.size()<<" memory regions, "<<c.sem.hw.devices.size()<<" devices)\n";return 0;}Optimizer opt;int level=2;fs::path out="build-vOS";for(int i=3;i<argc;i++){std::string a=argv[i];if(a=="-o"&&i+1<argc)out=argv[++i];else if(a=="--opt"&&i+1<argc)level=std::clamp(std::stoi(argv[++i]),0,3);}opt.optimize(c.ir,level);if(cmd=="emit-ir"){std::cout<<irToJson(c.ir)<<"\n";return 0;}Backend be;auto p=be.build(c.ir,level);for(auto&d:p.diagnostics)printDiag(d);if(hasErrors(p.diagnostics)){std::cerr<<"VOS: backend rejected unsupported executable syntax\n";return 3;}fs::create_directories(out);writeText(out/"manifest.json",p.manifest);writeText(out/"module.js",p.js);writeBytes(out/"module.wasm",p.wasm);writeBytes(out/"module.v74.bin",p.asmV74);writeText(out/"symbols.json",p.debugJson);writeText(out/"library.json",p.libraryJson);std::string stem=src.stem().string();writeBytes(out/(stem+".vhw"),p.vhw);writeBytes(out/(stem+".vimg"),p.vimg);writeBytes(out/(stem+".vxe"),p.vxe);writeBytes(out/(stem+".vlib"),p.vlib);writeBytes(out/(stem+".vdbg"),p.vdbg);std::cout<<"VOS: built "<<stem<<" -> "<<out.string()<<"\n"<<"  JS: "<<p.js.size()<<" bytes\n  WASM: "<<p.wasm.size()<<" bytes\n  V74 ASM: "<<p.asmV74.size()<<" bytes\n  VXE: "<<p.vxe.size()<<" bytes\n";return 0;}catch(const std::exception&e){std::cerr<<"VOS fatal: "<<e.what()<<"\n";return 1;}}
