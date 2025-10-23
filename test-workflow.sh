#!/bin/bash
# Test script to demonstrate dagrun CLI capabilities

echo "=== DagRun CLI Demo ==="
echo ""

echo "1. Validating workflow..."
node dist/cli/index.js validate examples/simple-workflow.yaml
echo ""

echo "2. Showing execution plan..."
node dist/cli/index.js plan examples/file-workflow.yaml
echo ""

echo "3. Running workflow..."
node dist/cli/index.js run examples/simple-workflow.yaml --verbose
echo ""

echo "=== Demo Complete ==="
