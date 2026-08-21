#compdef ur

_ur() {
  local state
  _arguments '1: :->cmd' '*: :->args'
  local -a lines
  lines=(${(f)"$(ur _completions 2>/dev/null)"})
  case $state in
    cmd)
      local line name desc
      local -a cmdList
      for line in $lines; do
        name=${line%%$'\t'*}
        desc=${${line#*$'\t'}%%$'\t'*}
        cmdList+=("$name:$desc")
      done
      _describe 'command' cmdList
      ;;
    args)
      local line name completesWith
      for line in $lines; do
        name=${line%%$'\t'*}
        if [[ "$name" != "$words[2]" ]]; then
          continue
        fi
        completesWith=${line##*$'\t'}
        if [[ "$completesWith" == "_ids" ]]; then
          compadd -- ${(f)"$(ur _ids 2>/dev/null)"}
        elif [[ -n "$completesWith" ]]; then
          compadd -- ${(s.,.)completesWith}
        fi
      done
      ;;
  esac
}

compdef _ur ur
