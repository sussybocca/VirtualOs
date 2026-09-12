#include "vos/parser.hpp"
namespace vos {
Parser::Parser(std::string f,std::vector<Token> t):file_(std::move(f)),t_(std::move(t)){}
const Token& Parser::peek(size_t n)const{static Token e{};return i_+n<t_.size()?t_[i_+n]:e;}bool Parser::end()const{return peek().kind==TokKind::End;}Token Parser::take(){return end()?peek():t_[i_++];}bool Parser::match(std::string_view x)const{return peek().text==x;}bool Parser::consume(std::string_view x){if(match(x)){++i_;return true;}return false;}
void Parser::error(const Token&t,std::string c,std::string m){d_.push_back({Diagnostic::Level::Error,std::move(c),std::move(m),t.span});}
std::vector<Token> Parser::collectBalanced(std::string_view open,std::string_view close){std::vector<Token> r;if(!consume(open)){error(peek(),"VOS-E0100","expected '"+std::string(open)+"'");return r;}int depth=1;while(!end()&&depth){auto x=take();if(x.text==open)depth++;else if(x.text==close){depth--;if(!depth)break;}r.push_back(x);}if(depth)error(peek(),"VOS-E0101","unterminated block");return r;}
std::vector<Token> Parser::collectUntilTop(std::string_view term){std::vector<Token> r;int a=0,b=0,c=0;while(!end()){auto &p=peek();if(!a&&!b&&!c&&p.text==term)break;if(p.text=="(")a++;if(p.text==")")a--;if(p.text=="[")b++;if(p.text=="]")b--;if(p.text=="<")c++;if(p.text==">")c--;r.push_back(take());}return r;}
DeclKind Parser::kindFor(std::string_view s)const{static const std::map<std::string,DeclKind> m={{"domain",DeclKind::Domain},{"unit",DeclKind::Unit},{"import",DeclKind::Import},{"hardware",DeclKind::Hardware},{"memoryspace",DeclKind::MemorySpace},{"device",DeclKind::Device},{"shared",DeclKind::Shared},{"interrupt",DeclKind::Interrupt},{"proc",DeclKind::Procedure},{"pure",DeclKind::Procedure},{"driver",DeclKind::Driver},{"process",DeclKind::Process},{"task",DeclKind::Task},{"channel",DeclKind::Channel},{"state",DeclKind::State},{"machine",DeclKind::Machine},{"isa",DeclKind::Isa},{"target",DeclKind::Target},{"comptime",DeclKind::Comptime},{"asm",DeclKind::Assembly}};auto it=m.find(std::string(s));return it==m.end()?DeclKind::Unknown:it->second;}
std::string Parser::inferName(DeclKind k,const std::vector<Token>& h)const{
  if(k==DeclKind::Import){std::vector<Token> x;for(auto&t:h)if(t.text!="import")x.push_back(t);return tokensToSource(x);}
  if(k==DeclKind::Comptime)return"comptime";
  if(k==DeclKind::Shared||k==DeclKind::Channel){for(size_t z=h.size();z>0;--z)if(h[z-1].kind==TokKind::Identifier&&h[z-1].text!="shared"&&h[z-1].text!="channel"&&h[z-1].text!="atomic")return h[z-1].text;}
  static const std::unordered_set<std::string> skip={"domain","unit","import","hardware","machine","memoryspace","device","shared","interrupt","proc","pure","driver","process","task","channel","state","isa","target","comptime","asm","const","atomic"};
  for(auto&x:h)if(x.kind==TokKind::Identifier&&!skip.count(x.text))return x.text;
  return declKindName(k);
}
Decl Parser::parseDecl(){
  Token first=take(); Decl d; d.kind=kindFor(first.text); d.span=first.span; d.header.push_back(first);
  if(first.text=="pure" && match("proc")) d.header.push_back(take());
  int par=0,ang=0,br=0;
  while(!end()){
    if(d.kind==DeclKind::Interrupt && par==0&&ang==0&&br==0 && match("preserves")){
      d.header.push_back(take());
      if(!match("{")){error(peek(),"VOS-E0108","expected register set after preserves");break;}
      Token ob=peek();auto block=collectBalanced("{","}");ob.text="{";d.header.push_back(ob);d.header.insert(d.header.end(),block.begin(),block.end());Token cb=ob;cb.text="}";d.header.push_back(cb);continue;
    }
    if((d.kind==DeclKind::Procedure||d.kind==DeclKind::Assembly) && par==0&&ang==0&&br==0 && ((d.kind==DeclKind::Procedure&&(match("effects")||match("contract")))||(d.kind==DeclKind::Assembly&&(match("preserves")||match("clobbers"))))){
      Token label=take(); d.body.push_back(label);
      if(!match("{")){error(peek(),"VOS-E0107","expected block after "+label.text);break;}
      Token ob=peek(); auto block=collectBalanced("{","}"); ob.text="{"; d.body.push_back(ob); d.body.insert(d.body.end(),block.begin(),block.end()); Token cb=ob;cb.text="}";d.body.push_back(cb); continue;
    }
    if(match("{")&&par==0&&ang==0&&br==0){
      auto block=collectBalanced("{","}");
      if(d.kind==DeclKind::Procedure||d.kind==DeclKind::Assembly){Token marker=first;marker.kind=TokKind::Identifier;marker.text="__impl__";d.body.push_back(marker);Token ob=first;ob.text="{";d.body.push_back(ob);d.body.insert(d.body.end(),block.begin(),block.end());Token cb=first;cb.text="}";d.body.push_back(cb);}else d.body=std::move(block);
      break;
    }
    if(match(";")&&par==0&&ang==0&&br==0){take();break;}
    auto x=take(); if(x.text=="(")par++;else if(x.text==")")par--;else if(x.text=="<")ang++;else if(x.text==">")ang--;else if(x.text=="[")br++;else if(x.text=="]")br--; d.header.push_back(x);
  }
  d.name=inferName(d.kind,d.header); return d;
}
Program Parser::parse(){Program p;p.file=file_;if(consume("@")){if(!consume("vos"))error(peek(),"VOS-E0102","expected @vos language header");if(peek().kind==TokKind::Number)p.vosVersion=take().text;else error(peek(),"VOS-E0103","expected VOS version");if(!consume(";"))error(peek(),"VOS-E0104","expected ';' after @vos header");}else error(peek(),"VOS-E0105","source must begin with @vos <version>;");while(!end()){if(match("@")&&peek(1).text=="domain"){take();Token d=take();d.text="domain";t_.insert(t_.begin()+static_cast<long>(i_),d);}auto k=kindFor(peek().text);if(k==DeclKind::Unknown){error(peek(),"VOS-E0106","unknown top-level declaration '"+peek().text+"'");take();continue;}p.decls.push_back(parseDecl());}p.diagnostics=std::move(d_);return p;}
std::string tokensToSource(const std::vector<Token>& ts){std::ostringstream o;std::string prev;auto word=[](const Token&t){return t.kind==TokKind::Identifier||t.kind==TokKind::Number||t.kind==TokKind::String||t.kind==TokKind::Character;};for(size_t i=0;i<ts.size();++i){if(i&&word(ts[i])&&word(ts[i-1]))o<<' ';o<<ts[i].text;}return o.str();}
}
