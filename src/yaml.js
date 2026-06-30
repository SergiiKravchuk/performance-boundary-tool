const COMMENT_SENTINEL = Symbol('comment');

export function parseYaml(text) {
  const lines = preprocess(text);
  if (lines.length === 0) {
    return {};
  }

  let index = 0;
  const root = parseBlock(lines[0].indent);

  if (index !== lines.length) {
    throw new Error(`Unexpected YAML content near line ${lines[index].lineNumber}`);
  }

  return root;

  function parseBlock(indent) {
    const line = lines[index];
    if (!line || line.indent < indent) {
      return {};
    }

    if (line.indent > indent) {
      throw new Error(`Invalid indentation at line ${line.lineNumber}`);
    }

    return line.content.startsWith('- ') ? parseArray(indent) : parseObject(indent);
  }

  function parseObject(indent) {
    const value = {};

    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < indent) {
        break;
      }

      if (line.indent > indent) {
        throw new Error(`Invalid indentation at line ${line.lineNumber}`);
      }

      if (line.content.startsWith('- ')) {
        break;
      }

      const separatorIndex = line.content.indexOf(':');
      if (separatorIndex === -1) {
        throw new Error(`Expected key/value pair at line ${line.lineNumber}`);
      }

      const key = line.content.slice(0, separatorIndex).trim();
      const rest = line.content.slice(separatorIndex + 1).trim();
      index += 1;

      if (rest.length > 0) {
        value[key] = parseScalar(rest);
        continue;
      }

      if (index < lines.length && lines[index].indent > indent) {
        value[key] = parseBlock(lines[index].indent);
      } else {
        value[key] = {};
      }
    }

    return value;
  }

  function parseArray(indent) {
    const value = [];

    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < indent) {
        break;
      }

      if (line.indent > indent) {
        throw new Error(`Invalid indentation at line ${line.lineNumber}`);
      }

      if (!line.content.startsWith('- ')) {
        break;
      }

      const rest = line.content.slice(2).trim();
      index += 1;

      if (rest.length === 0) {
        if (index < lines.length && lines[index].indent > indent) {
          value.push(parseBlock(lines[index].indent));
        } else {
          value.push(null);
        }
        continue;
      }

      if (looksLikeKeyValue(rest)) {
        value.push(parseInlineObject(rest, indent));
        continue;
      }

      value.push(parseScalar(rest));
    }

    return value;
  }

  function parseInlineObject(rest, parentIndent) {
    const separatorIndex = rest.indexOf(':');
    const key = rest.slice(0, separatorIndex).trim();
    const value = {};
    const rawValue = rest.slice(separatorIndex + 1).trim();

    if (rawValue.length > 0) {
      value[key] = parseScalar(rawValue);
    } else if (index < lines.length && lines[index].indent > parentIndent) {
      value[key] = parseBlock(lines[index].indent);
    } else {
      value[key] = {};
    }

    if (index < lines.length && lines[index].indent > parentIndent) {
      const nestedIndent = lines[index].indent;
      const nestedObject = parseObject(nestedIndent);
      Object.assign(value, nestedObject);
    }

    return value;
  }
}

function preprocess(text) {
  const result = [];
  const rawLines = text.replace(/\r\n/g, '\n').split('\n');

  rawLines.forEach((rawLine, index) => {
    const withoutComment = stripComment(rawLine);
    if (withoutComment === COMMENT_SENTINEL) {
      return;
    }

    const trimmedRight = withoutComment.replace(/\s+$/, '');
    if (trimmedRight.trim().length === 0) {
      return;
    }

    const indentMatch = trimmedRight.match(/^ */);
    const indent = indentMatch ? indentMatch[0].length : 0;
    result.push({
      indent,
      content: trimmedRight.slice(indent),
      lineNumber: index + 1
    });
  });

  return result;
}

function stripComment(rawLine) {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let index = 0; index < rawLine.length; index += 1) {
    const character = rawLine[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (character === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (character === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (character === '#' && !inSingleQuote && !inDoubleQuote) {
      if (index === 0 || /\s/.test(rawLine[index - 1])) {
        return index === 0 ? COMMENT_SENTINEL : rawLine.slice(0, index);
      }
    }
  }

  return rawLine;
}

function looksLikeKeyValue(text) {
  const separatorIndex = text.indexOf(':');
  return separatorIndex > 0;
}

function parseScalar(rawValue) {
  const value = rawValue.trim();

  if (value === 'null' || value === '~') {
    return null;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}
