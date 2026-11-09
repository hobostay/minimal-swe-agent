function parseLabels(input) {
  return input.split(",").filter(Boolean).map(label => label.trim());
}

module.exports = { parseLabels };
