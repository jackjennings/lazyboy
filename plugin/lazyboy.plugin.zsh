0=${(%):-%N}
lazyboy_bin_dir="${0:A:h}/../bin"
[[ ":$PATH:" == *":$lazyboy_bin_dir:"* ]] || export PATH="$lazyboy_bin_dir:$PATH"
unset lazyboy_bin_dir

alias ltk='lazyboy tick'
alias lap='lazyboy approve'
alias lst='lazyboy status'
alias len='lazyboy enable'
alias ldi='lazyboy disable'
alias lco='lazyboy completion'
alias lrt='lazyboy retry'
alias ldc='lazyboy decline'
alias lrv='lazyboy review'
alias lsh='lazyboy shell'
alias lta='lazyboy tail'
alias lup='lazyboy update'
alias lhd='lazyboy hud'
alias lus='lazyboy usage'

source <(lazyboy completion zsh)

compdef lap=lazyboy
compdef lrt=lazyboy
compdef ldc=lazyboy
compdef lrv=lazyboy
compdef lsh=lazyboy
compdef lta=lazyboy
