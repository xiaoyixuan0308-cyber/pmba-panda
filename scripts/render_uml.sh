#!/usr/bin/env bash
# Render every .puml file in a folder to PNG and SVG with a local PlantUML.
#
# Usage:
#   scripts/render_uml.sh [models-dir]          # default: spec/models
#   scripts/render_uml.sh [models-dir] --kroki  # use the public Kroki service instead
#
# Local rendering is the default: diagram content never leaves the machine.
# --kroki sends every diagram to https://kroki.io. Only use it when the user has
# been told this and the diagrams contain no real business information.
#
# PlantUML is located in this order:
#   1. $PLANTUML_JAR
#   2. a `plantuml` command on PATH
#   3. ~/.cache/pmba-panda/plantuml.jar (downloaded from GitHub releases on first use)
# Graphviz (`dot`) is optional: without it the built-in smetana layout is used.
#
# Exit code: 0 if every diagram rendered, 1 if any diagram has an error.

set -uo pipefail

DIR="spec/models"
USE_KROKI=0
for arg in "$@"; do
  case "$arg" in
    --kroki) USE_KROKI=1 ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) DIR="$arg" ;;
  esac
done

if [ ! -d "$DIR" ]; then
  echo "Folder not found: $DIR" >&2
  exit 1
fi

shopt -s nullglob
FILES=("$DIR"/*.puml)
if [ ${#FILES[@]} -eq 0 ]; then
  echo "No .puml files in $DIR"
  exit 0
fi

FAILED=()

render_kroki() {
  local f="$1" base="${1%.puml}" fmt
  for fmt in png svg; do
    if ! curl -sSf -X POST -H "Content-Type: text/plain" --data-binary @"$f" \
         "https://kroki.io/plantuml/$fmt" -o "$base.$fmt"; then
      return 1
    fi
  done
}

if [ "$USE_KROKI" -eq 1 ]; then
  echo "WARNING: sending diagram content to the public Kroki service (kroki.io)."
  echo "Do not use this for diagrams that describe real business information."
  for f in "${FILES[@]}"; do
    if render_kroki "$f"; then echo "OK    $(basename "$f")"; else echo "ERROR $(basename "$f")"; FAILED+=("$f"); fi
  done
else
  if ! command -v java >/dev/null 2>&1; then
    echo "Java is not installed, so PlantUML cannot run locally." >&2
    echo "Install a Java runtime (version 11 or newer) and run this script again." >&2
    exit 1
  fi

  RUN=()
  if [ -n "${PLANTUML_JAR:-}" ] && [ -f "$PLANTUML_JAR" ]; then
    RUN=(java -jar "$PLANTUML_JAR")
  elif command -v plantuml >/dev/null 2>&1; then
    RUN=(plantuml)
  else
    CACHE="$HOME/.cache/pmba-panda"
    JAR="$CACHE/plantuml.jar"
    if [ ! -f "$JAR" ]; then
      echo "PlantUML not found; downloading it once to $JAR"
      mkdir -p "$CACHE"
      if ! curl -sSfL -o "$JAR.part" \
           "https://github.com/plantuml/plantuml/releases/latest/download/plantuml.jar"; then
        rm -f "$JAR.part"
        echo "Download failed. Download plantuml.jar manually and set PLANTUML_JAR to its path." >&2
        exit 1
      fi
      mv "$JAR.part" "$JAR"
    fi
    RUN=(java -jar "$JAR")
  fi

  OPTS=(-charset UTF-8)
  if ! command -v dot >/dev/null 2>&1; then
    echo "Graphviz not found; using the built-in smetana layout."
    OPTS+=(-Playout=smetana)
  fi

  for f in "${FILES[@]}"; do
    name="$(basename "$f")"
    if ! "${RUN[@]}" "${OPTS[@]}" -checkonly "$f" >/dev/null 2>&1; then
      echo "ERROR $name (syntax error; see the generated image for the line number)"
      "${RUN[@]}" "${OPTS[@]}" -tpng "$f" >/dev/null 2>&1
      FAILED+=("$f")
      continue
    fi
    if "${RUN[@]}" "${OPTS[@]}" -tpng "$f" >/dev/null 2>&1 && \
       "${RUN[@]}" "${OPTS[@]}" -tsvg "$f" >/dev/null 2>&1; then
      echo "OK    $name"
    else
      echo "ERROR $name (rendering failed)"
      FAILED+=("$f")
    fi
  done
fi

echo
echo "Rendered $(( ${#FILES[@]} - ${#FAILED[@]} )) of ${#FILES[@]} diagrams."
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "Fix the files marked ERROR (see references/plantuml-pitfalls.md), then run again."
  exit 1
fi
exit 0
