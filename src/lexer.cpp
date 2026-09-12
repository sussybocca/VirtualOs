#include "vos/lexer.hpp"
namespace vos {
Lexer::Lexer(std::string f,std::string s):file_(std::move(f)),src_(std::move(s)){}
char Lexer::peek(size_t n)const{return i_+n<src_.size()?src_[i_+n]:'\0';}
bool Lexer::atEnd()const{return i_>=src_.size();}
char Lexer::take(){ if(atEnd())return '\0'; char c=src_[i_++]; if(c=='\n'){line_++;col_=1;}else col_++; return c; }
Token Lexer::make(TokKind k,std::string t,int l,int c,int el,int ec){return Token{k,std::move(t),Span{file_,l,c,el,ec}};}
void Lexer::skipSpaceAndComments(){ for(;;){ while(std::isspace((unsigned char)peek()))take(); if(peek()=='/'&&peek(1)=='/'){while(!atEnd()&&take()!='\n');continue;} if(peek()=='/'&&peek(1)=='*'){int l=line_,c=col_;take();take();bool ok=false;while(!atEnd()){if(peek()=='*'&&peek(1)=='/'){take();take();ok=true;break;}take();}if(!ok)diags_.push_back({Diagnostic::Level::Error,"VOS-E0001","unterminated block comment",{file_,l,c,line_,col_}});continue;} break;} }
Token Lexer::ident(){int l=line_,c=col_;std::string t; while(std::isalnum((unsigned char)peek())||peek()=='_'||peek()=='$')t+=take(); return make(TokKind::Identifier,t,l,c,line_,col_);}
Token Lexer::number(){int l=line_,c=col_;std::string t; if(peek()=='0'&&(peek(1)=='x'||peek(1)=='X'||peek(1)=='b'||peek(1)=='B')){t+=take();t+=take();} while(std::isalnum((unsigned char)peek())||peek()=='_'||peek()=='.')t+=take(); return make(TokKind::Number,t,l,c,line_,col_);}
Token Lexer::stringLit(char q,TokKind k){int l=line_,c=col_;std::string t;t+=take();bool esc=false;while(!atEnd()){char ch=take();t+=ch;if(esc){esc=false;continue;}if(ch=='\\'){esc=true;continue;}if(ch==q)return make(k,t,l,c,line_,col_);if(ch=='\n'&&q=='\'')break;}diags_.push_back({Diagnostic::Level::Error,"VOS-E0002","unterminated literal",{file_,l,c,line_,col_}});return make(k,t,l,c,line_,col_);}
Token Lexer::symbol(){int l=line_,c=col_; static const std::vector<std::string> ops={"--[","-->" ,"::",":=","<-","->","=>","..","==","!=","<=",">=","<<",">>","&&","||","++","--","+=","-=","*=","/=","?."}; for(auto&op:ops){ if(src_.compare(i_,op.size(),op)==0){std::string t;for(size_t n=0;n<op.size();++n)t+=take();return make(TokKind::Symbol,t,l,c,line_,col_);} } std::string t(1,take());return make(TokKind::Symbol,t,l,c,line_,col_);}
std::vector<Token> Lexer::lex(){std::vector<Token> out;while(!atEnd()){skipSpaceAndComments();if(atEnd())break;char c=peek(); if(std::isalpha((unsigned char)c)||c=='_'||c=='$')out.push_back(ident());else if(std::isdigit((unsigned char)c))out.push_back(number());else if(c=='"')out.push_back(stringLit('"',TokKind::String));else if(c=='\'')out.push_back(stringLit('\'',TokKind::Character));else out.push_back(symbol());} out.push_back(make(TokKind::End,"",line_,col_,line_,col_));return out;}
}
