#pragma once
#include "common.hpp"
namespace vos {
enum class TokKind { Identifier, Number, String, Character, Symbol, End };
struct Token { TokKind kind=TokKind::End; std::string text; Span span; };
class Lexer {
 public: Lexer(std::string file,std::string source); std::vector<Token> lex(); const std::vector<Diagnostic>& diagnostics() const{return diags_;}
 private: std::string file_,src_; size_t i_=0; int line_=1,col_=1; std::vector<Diagnostic> diags_;
 char peek(size_t n=0)const; char take(); bool atEnd()const; void skipSpaceAndComments(); Token make(TokKind,std::string,int,int,int,int); Token ident(); Token number(); Token stringLit(char q,TokKind k); Token symbol();
};
}
