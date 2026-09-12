#pragma once
#include "ast.hpp"
namespace vos {
class Parser { public: Parser(std::string file,std::vector<Token> tokens); Program parse(); private: std::string file_;std::vector<Token> t_;size_t i_=0;std::vector<Diagnostic> d_; const Token& peek(size_t n=0)const;bool end()const;Token take();bool match(std::string_view)const;bool consume(std::string_view);void error(const Token&,std::string,std::string);std::vector<Token> collectBalanced(std::string_view open,std::string_view close);std::vector<Token> collectUntilTop(std::string_view);Decl parseDecl();DeclKind kindFor(std::string_view)const;std::string inferName(DeclKind,const std::vector<Token>&)const;};
std::string tokensToSource(const std::vector<Token>& ts);
}
