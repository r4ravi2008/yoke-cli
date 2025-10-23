#!/bin/bash

echo "╔════════════════════════════════════════════╗"
echo "║   DagRun - YAML Workflow DAG Runner        ║"
echo "╚════════════════════════════════════════════╝"
echo ""
echo "Available commands:"
echo "  • dagrun validate <workflow.yaml>  - Validate workflow"
echo "  • dagrun plan <workflow.yaml>      - Show execution plan"
echo "  • dagrun run <workflow.yaml>       - Execute workflow"
echo "  • dagrun show --run <dir>          - Show run details"
echo ""
echo "Example workflows available in examples/"
echo ""
echo "Try: node dist/cli/index.js validate examples/simple-workflow.yaml"
echo ""
echo "Press Ctrl+C to exit..."

# Keep the script running
while true; do
  sleep 60
done
