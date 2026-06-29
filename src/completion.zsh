#compdef lazyboy

_lazyboy() {
  local state
  _arguments '1: :->cmd' '*: :->args'
  case $state in
    cmd)
      local commands
      commands=(
        'tick:advance all active tickets'
        'approve:approve the current phase gate'
        'status:show all active tickets'
        'enable:add cron job'
        'disable:remove cron job'
        'completion:print shell completion script'
        'review:review the latest phase output'
      )
      _describe 'command' commands
      ;;
    args)
      case $words[2] in
        approve)
          compadd -- ${(f)"$(lazyboy _ids 2>/dev/null)"}
          ;;
        completion)
          compadd -- zsh
          ;;
        review)
          compadd -- ${(f)"$(lazyboy _ids 2>/dev/null)"}
          ;;
      esac
      ;;
  esac
}

compdef _lazyboy lazyboy
