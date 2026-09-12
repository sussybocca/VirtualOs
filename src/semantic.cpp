#include "vos/semantic.hpp"
#include "vos/parser.hpp"
#include <cmath>
namespace vos {
void SemanticAnalyzer::diag(Diagnostic::Level l,std::string c,std::string msg,const Span&s){m_.diagnostics.push_back({l,std::move(c),std::move(msg),s});}
static bool isId(const Token&t){return t.kind==TokKind::Identifier;}
static std::string stripNum(std::string s){s.erase(std::remove(s.begin(),s.end(),'_'),s.end());return s;}
uint64_t SemanticAnalyzer::parseQuantity(const std::vector<Token>&t,size_t&i,bool*ok){
  if (ok) *ok = false;
  if (i >= t.size() || t[i].kind != TokKind::Number) return 0;
  std::string s=stripNum(t[i].text);i++;
  static const std::vector<std::pair<std::string,long double>> units={{"GiB",1024.0L*1024*1024},{"MiB",1024.0L*1024},{"KiB",1024.0L},{"GHz",1000000000.0L},{"MHz",1000000.0L},{"kHz",1000.0L},{"Hz",1.0L},{"ms",1000000.0L},{"us",1000.0L},{"ns",1.0L},{"B",1.0L},{"s",1000000000.0L}};
  std::string unit; long double multiplier=1;
  bool hex=s.rfind("0x",0)==0||s.rfind("0X",0)==0, bin=s.rfind("0b",0)==0||s.rfind("0B",0)==0;
  if(!hex&&!bin){for(auto&[u,m]:units)if(s.size()>u.size()&&s.ends_with(u)){unit=u;multiplier=m;s.resize(s.size()-u.size());break;}}
  // Integer type suffixes are values, not physical units.
  if(unit.empty()&&!hex&&!bin){auto p=s.find_last_not_of("0123456789.");if(p!=std::string::npos){std::string sf=s.substr(p+1);(void)sf;}}
  // Lexer keeps u32/u74 attached to numeric tokens. Strip a trailing [ui][0-9]+ suffix.
  for(size_t p=1;p<s.size();++p){if((s[p]=='u'||s[p]=='i')&&p+1<s.size()&&std::all_of(s.begin()+p+1,s.end(),[](char c){return std::isdigit((unsigned char)c);})) {s.resize(p);break;}}
  if(unit.empty()&&i<t.size()&&t[i].kind==TokKind::Identifier){for(auto&[u,m]:units)if(t[i].text==u){unit=u;multiplier=m;i++;break;}}
  long double v=0;try{if(hex)v=(long double)std::stoull(s,nullptr,16);else if(bin)v=(long double)std::stoull(s.substr(2),nullptr,2);else v=std::stold(s);}catch(...){return 0;}
  if (ok) *ok = true;
  return (uint64_t)(v*multiplier);
}
std::string SemanticAnalyzer::joinRange(const std::vector<Token>&t,size_t a,size_t b){if(a>=b||a>=t.size())return{};std::vector<Token>x(t.begin()+a,t.begin()+std::min(b,t.size()));return tokensToSource(x);}
TypeRef SemanticAnalyzer::parseTypeText(std::string s){TypeRef r;r.text=s;if(s=="byte"||s=="u8")r.bits=8;else if(s=="u16"||s=="i16")r.bits=16;else if(s=="u24"||s=="i24")r.bits=24;else if(s=="u32"||s=="i32"||s=="f32")r.bits=32;else if(s=="u48"||s=="i48")r.bits=48;else if(s=="u64"||s=="i64"||s=="f64")r.bits=64;else if(s=="u74"||s=="i74")r.bits=74;else if(s=="u96")r.bits=96;else if(s=="u128"||s=="i128"||s=="f128")r.bits=128;else if(s=="u256")r.bits=256;r.isSigned=!s.empty()&&s[0]=='i';auto p=s.find("addr<");if(p!=std::string::npos){r.isAddress=true;auto c=s.find(',',p);auto e=s.find('>',p);if(c!=std::string::npos)r.addressSpace=s.substr(p+5,c-(p+5));else if(e!=std::string::npos)r.addressSpace=s.substr(p+5,e-(p+5));}return r;}
void SemanticAnalyzer::analyzeHardware(const Decl&d){m_.hw.name=d.name;auto&t=d.body;for(size_t i=0;i<t.size();){if(t[i].text=="architecture"&&i+1<t.size()){m_.hw.architecture=t[i+1].text;i+=2;continue;}if((t[i].text=="cpu"||t[i].text=="memory"||t[i].text=="gpu"||t[i].text=="cache")&&i+1<t.size()){HardwareComponent c;c.kind=t[i].text;c.name=t[i+1].text;i+=2;if(i<t.size()&&t[i].text=="{"){int depth=1;size_t s=++i;while(i<t.size()&&depth){if(t[i].text=="{")depth++;else if(t[i].text=="}")depth--;if(depth)i++;}size_t e=i;if(i<t.size())i++;for(size_t j=s;j<e;){if(isId(t[j])&&j+1<e&&t[j+1].text=="="){std::string key=t[j].text;j+=2;size_t v=j;while(j<e&&t[j].text!=";")j++;c.properties[key]=joinRange(t,v,j);if(j<e)j++;}else j++;}}m_.hw.components.push_back(std::move(c));continue;}i++;}}
void SemanticAnalyzer::analyzeMemory(const Decl&d){auto&t=d.body;for(size_t i=0;i<t.size();){if(t[i].text!="region"){i++;continue;}MemoryRegion r;r.span=t[i].span;if(i+1>=t.size()){diag(Diagnostic::Level::Error,"VOS-E2000","region requires a name",r.span);break;}r.name=t[i+1].text;i+=2;if(i<t.size()&&t[i].text=="@"){i++;bool ok=false;r.address=parseQuantity(t,i,&ok);if(!ok)diag(Diagnostic::Level::Error,"VOS-E2001","invalid region address",r.span);}while(i<t.size()&&t[i].text!=";"){std::string k=t[i].text;i++;if(k=="size"){bool ok=false;r.size=parseQuantity(t,i,&ok);if(!ok)diag(Diagnostic::Level::Error,"VOS-E2002","invalid region size",r.span);}else if(k=="alignment"){bool ok=false;r.alignment=parseQuantity(t,i,&ok);if(!ok)diag(Diagnostic::Level::Error,"VOS-E2003","invalid alignment",r.span);}else if(k=="permissions"&&i<t.size()){std::string p;while(i<t.size()&&t[i].text!="cache"&&t[i].text!="alignment"&&t[i].text!="mapping"&&t[i].text!=";")p+=t[i++].text;r.permissions=p;}else if(k=="cache"&&i<t.size())r.cache=t[i++].text;else if(k=="mapping"){size_t s=i;while(i<t.size()&&t[i].text!=";"&&t[i].text!="permissions"&&t[i].text!="alignment"&&t[i].text!="cache")i++;r.mapping=joinRange(t,s,i);}else{i++;}}if(i<t.size())i++;if(!r.size)diag(Diagnostic::Level::Error,"VOS-E2004","region '"+r.name+"' has zero size",r.span);m_.hw.regions.push_back(std::move(r));}}
void SemanticAnalyzer::analyzeDevice(const Decl&d){DeviceDef dev;dev.name=d.name;auto&t=d.body;for(size_t i=0;i<t.size();){if(t[i].text=="mmio"){i++;if(i<t.size()&&isId(t[i]))i++;if(i<t.size()&&t[i].text=="@"){i++;bool ok=false;dev.mmioBase=parseQuantity(t,i,&ok);if(!ok)diag(Diagnostic::Level::Error,"VOS-E2100","invalid MMIO base",d.span);}if(i<t.size()&&t[i].text=="size"){i++;bool ok=false;dev.mmioSize=parseQuantity(t,i,&ok);if(!ok)diag(Diagnostic::Level::Error,"VOS-E2101","invalid MMIO size",d.span);}if(i<t.size()&&t[i].text=="{"){int depth=1;i++;while(i<t.size()&&depth){if(t[i].text=="register"){RegisterDef r;i++;if(i<t.size())r.name=t[i++].text;if(i<t.size()&&t[i].text==":"){i++;size_t s=i;while(i<t.size()&&t[i].text!="@"&&t[i].text!=";")i++;r.type=joinRange(t,s,i);}if(i<t.size()&&t[i].text=="@"){i++;if(i<t.size()&&t[i].text=="+")i++;bool ok=false;r.offset=parseQuantity(t,i,&ok);}while(i<t.size()&&t[i].text!=";"){if(t[i].text=="access"&&i+1<t.size()){r.access=t[i+1].text;i+=2;}else if(t[i].text=="reset"&&i+1<t.size()){i++;bool ok=false;r.reset=parseQuantity(t,i,&ok);}else if(t[i].text=="volatile"){r.isVolatile=true;i++;}else i++;}if(i<t.size())i++;dev.registers.push_back(std::move(r));continue;}if(t[i].text=="{")depth++;else if(t[i].text=="}")depth--;i++;}}}else i++;}m_.hw.devices.push_back(std::move(dev));}
void SemanticAnalyzer::analyzeOwnershipAndEffects(ProcInfo&p){
  std::unordered_set<std::string> moved;
  std::unordered_map<std::string,TypeRef> vars;
  for(auto&[n,t]:p.params) vars[n]=parseTypeText(t);
  auto literalType=[&](const Token&x)->TypeRef{TypeRef r;if(x.kind!=TokKind::Number)return r;std::string q=x.text;auto pos=q.find_first_not_of("0123456789abcdefABCDEFxXbB._");std::string sf=pos==std::string::npos?"":q.substr(pos);if(sf=="u8")r.bits=8;else if(sf=="u16"||sf=="i16")r.bits=16;else if(sf=="u24"||sf=="i24")r.bits=24;else if(sf=="u32"||sf=="i32")r.bits=32;else if(sf=="u48"||sf=="i48")r.bits=48;else if(sf=="u64"||sf=="i64")r.bits=64;else if(sf=="u74"||sf=="i74")r.bits=74;else if(sf=="u96")r.bits=96;else if(sf=="u128"||sf=="i128")r.bits=128;else if(sf=="u256")r.bits=256;else r.bits=32;return r;};
  auto checkAssign=[&](const TypeRef&dst,size_t a,size_t b,const Span&sp){
    if (a >= b) return;
    bool explicitCast = false;
    for (size_t j = a; j < b; ++j)
      if (p.body[j].text == "truncate" || p.body[j].text == "checked_cast") explicitCast = true;
    TypeRef src;
    if(b==a+1){if(p.body[a].kind==TokKind::Number)src=literalType(p.body[a]);else if(p.body[a].kind==TokKind::Identifier&&vars.count(p.body[a].text))src=vars[p.body[a].text];}
    if(!explicitCast&&dst.bits&&src.bits&&src.bits>dst.bits)diag(Diagnostic::Level::Error,"VOS-E3201","implicit narrowing from "+std::to_string(src.bits)+" bits to "+std::to_string(dst.bits)+" bits is forbidden",sp);
    if(!explicitCast&&dst.isAddress&&src.isAddress&&dst.addressSpace!=src.addressSpace)diag(Diagnostic::Level::Error,"VOS-E3202","address-space conversion from "+src.addressSpace+" to "+dst.addressSpace+" requires explicit translation",sp);
    if(dst.text.find("ptr<")!=std::string::npos&&b==a+1&&p.body[a].text=="null")diag(Diagnostic::Level::Error,"VOS-E3203","null pointers are forbidden in strict VOS",sp);
  };
  for(size_t i=0;i<p.body.size();++i){auto&x=p.body[i];
    if((x.text=="var"||x.text=="bind")&&i+2<p.body.size()&&p.body[i+1].kind==TokKind::Identifier){std::string n=p.body[i+1].text;size_t j=i+2;if(j<p.body.size()&&p.body[j].text==":"){j++;size_t ts=j;int a=0;while(j<p.body.size()){if(p.body[j].text=="<")a++;else if(p.body[j].text==">")a--;if(a==0&&(p.body[j].text==":="||p.body[j].text=="="||p.body[j].text=="<-"||p.body[j].text==";"))break;j++;}auto ty=parseTypeText(joinRange(p.body,ts,j));vars[n]=ty;if(j<p.body.size()&&(p.body[j].text==":="||p.body[j].text=="="||p.body[j].text=="<-")){size_t e=j+1;int d=0;while(e<p.body.size()){if(p.body[e].text=="(")d++;else if(p.body[e].text==")")d--;if(d==0&&p.body[e].text==";")break;e++;}checkAssign(ty,j+1,e,x.span);}}}
    if(x.text=="move"&&i+1<p.body.size()&&isId(p.body[i+1])){moved.insert(p.body[i+1].text);continue;}
    if(isId(x)&&moved.count(x.text)){bool isMoveUse=i>0&&p.body[i-1].text=="move";if(!isMoveUse)diag(Diagnostic::Level::Error,"VOS-E3301","use of moved value '"+x.text+"'",x.span);}
    if(x.text=="<-"){
      size_t s=i;while(s>0&&p.body[s-1].text!=";"&&p.body[s-1].text!="{"&&p.body[s-1].text!="}")s--;bool lhsDevice=false;for(size_t j=s;j<i;j++)if(p.body[j].text==".")lhsDevice=true;
      std::string eff=lhsDevice?"mmio.write":"mmio.read";if(!p.effects.count(eff))diag(Diagnostic::Level::Error,lhsDevice?"VOS-E3401":"VOS-E3404","hardware transaction requires effect "+eff,x.span);
    }
    if(x.text=="unsafe"&&!p.effects.count("memory.raw"))diag(Diagnostic::Level::Error,"VOS-E3402","unsafe memory operation requires effect memory.raw",x.span);
  }
  if(p.pure&&!p.effects.empty())diag(Diagnostic::Level::Error,"VOS-E3403","pure procedure cannot declare side effects",p.span);
}
void SemanticAnalyzer::analyzeProc(const Decl&d){ProcInfo p;p.span=d.span;p.pure=!d.header.empty()&&d.header[0].text=="pure";p.name=d.name;auto&h=d.header;size_t pi=0;while(pi<h.size()&&h[pi].text!="(")pi++;if(pi<h.size()){size_t i=pi+1;while(i<h.size()&&h[i].text!=")"){if(h[i].kind!=TokKind::Identifier){i++;continue;}std::string n=h[i++].text;if(i>=h.size()||h[i].text!=":"){diag(Diagnostic::Level::Error,"VOS-E3001","parameter '"+n+"' missing type",h[i-1].span);break;}i++;size_t s=i;int angle=0;while(i<h.size()){if(h[i].text=="<")angle++;else if(h[i].text==">")angle--;if(angle==0&&(h[i].text==","||h[i].text==")"))break;i++;}p.params.push_back({n,joinRange(h,s,i)});if(i<h.size()&&h[i].text==",")i++;}}
  for (size_t i = 0; i + 1 < h.size(); ++i) {
    if (h[i].text == "->") { p.returnType = joinRange(h, i + 1, h.size()); break; }
  }
  p.body = d.body;
  // effects block is embedded at the beginning of procedure body in VOS grammar.
  for(size_t i=0;i<p.body.size();++i){if(p.body[i].text=="effects"&&i+1<p.body.size()&&p.body[i+1].text=="{"){int depth=1;i+=2;std::string acc;for(;i<p.body.size()&&depth;i++){if(p.body[i].text=="{"){depth++;continue;}if(p.body[i].text=="}"){if(--depth==0)break;continue;}if(p.body[i].text==";"){if(!acc.empty()){p.effects.insert(acc);acc.clear();}}else acc+=p.body[i].text;}break;}}
  analyzeOwnershipAndEffects(p);m_.procs.push_back(std::move(p));}
void SemanticAnalyzer::analyzeComptime(const Decl&d){
  auto&t=d.body;for(size_t i=0;i<t.size();++i)if(t[i].text=="assert"){
    size_t a=i+1;if(a<t.size()&&t[a].text=="(")a++;size_t e=a;int dep=0;while(e<t.size()){if(t[e].text=="(")dep++;else if(t[e].text==")"){if(dep==0)break;dep--;}if(dep==0&&t[e].text==";")break;e++;}
    bool known=false,value=false;
    if(e==a+1&&(t[a].text=="true"||t[a].text=="false")){known=true;value=t[a].text=="true";}
    else {size_t eq=a;while(eq<e&&t[eq].text!="=="&&t[eq].text!="!=")eq++;if(eq<e){size_t l=a,r=eq+1;bool ok1=false,ok2=false;uint64_t lv=parseQuantity(t,l,&ok1),rv=parseQuantity(t,r,&ok2);if(ok1&&ok2&&l==eq&&r==e){known=true;value=t[eq].text=="=="?lv==rv:lv!=rv;}}}
    if(known&&!value)diag(Diagnostic::Level::Error,"VOS-E3500","compile-time assertion failed",t[i].span);else if(!known)diag(Diagnostic::Level::Warning,"VOS-W3501","compile-time assertion could not be fully evaluated; retained for backend metadata",t[i].span);
  }
}
void SemanticAnalyzer::analyzeDecl(const Decl&d){switch(d.kind){
  case DeclKind::Domain:{std::string dom=d.name;if(dom!="safe"&&dom!="kernel"&&dom!="metal")diag(Diagnostic::Level::Error,"VOS-E1001","domain must be safe, kernel, or metal",d.span);else m_.domain=dom;break;}
  case DeclKind::Import:m_.imports.insert(d.name);break;
  case DeclKind::Hardware:analyzeHardware(d);break;
  case DeclKind::MemorySpace:analyzeMemory(d);break;
  case DeclKind::Device:analyzeDevice(d);break;
  case DeclKind::Procedure:analyzeProc(d);break;
  case DeclKind::Comptime:analyzeComptime(d);break;
  default:break;}}
void SemanticAnalyzer::validateRegions(){auto r=m_.hw.regions;std::sort(r.begin(),r.end(),[](auto&a,auto&b){return a.address<b.address;});for(size_t i=1;i<r.size();++i){if(r[i].address<r[i-1].address+r[i-1].size)diag(Diagnostic::Level::Error,"VOS-E2200","memory regions '"+r[i-1].name+"' and '"+r[i].name+"' overlap",r[i].span);}for(auto&x:r)if(x.alignment&&x.address%x.alignment)diag(Diagnostic::Level::Error,"VOS-E2201","region '"+x.name+"' address violates alignment",x.span);}
SemanticModel SemanticAnalyzer::analyze(Program p){m_=SemanticModel{};m_.program=std::move(p);m_.diagnostics=m_.program.diagnostics;for(auto&d:m_.program.decls)analyzeDecl(d);validateRegions();return std::move(m_);}
}
