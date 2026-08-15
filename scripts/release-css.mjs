import postcss from "postcss";
import valueParser from "postcss-value-parser";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function validateCss(source, { declarationList = false, fromFile, resolveReference }) {
  const parseSource = declarationList ? `.inline-style { ${source} }` : source;
  const root = postcss.parse(parseSource, { from: fromFile });
  root.walkAtRules((rule) => {
    assert(rule.name.toLowerCase() !== "import", `CSS @import is forbidden in ${fromFile}`);
  });

  const values = [];
  root.walkDecls((declaration) => values.push(declaration.value));
  root.walkAtRules((rule) => values.push(rule.params));
  for (const value of values) {
    const references = [];
    valueParser(value).walk((node) => {
      if (node.type === "function" && node.value.toLowerCase() === "url") {
        references.push(
          valueParser
            .stringify(node.nodes)
            .trim()
            .replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2"),
        );
      }
    });
    for (const reference of references) {
      await resolveReference(reference);
    }
  }
}
