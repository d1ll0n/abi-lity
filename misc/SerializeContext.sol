struct SerializeContext {
  uint256 depth;
  string output;
}

bytes32 constant NL_SPACES_MASK = 0x0020202020202020202020202020202020202020202020202020202020202020;
bytes32 constant SPACES = 0x2020202020202020202020202020202020202020202020202020202020202020;
bytes32 constant NL_SPACES = 0x0a20202020202020202020202020202020202020202020202020202020202020;

library SerializeContextLib {
  using SerializeContextLib for *;

  function indent(uint256 depth) internal pure returns (string memory indent) {
    assembly {
      indent := mload(0x40)
      mstore(0x40, add(indent, 0x20))
      mstore(indent, depth)
      mstore(add(indent, 0x20), xor(SPACES, shr(mul(depth, 8), SPACES)))
    }
  }

  function newLineIndent(uint256 depth) internal pure returns (string memory indent) {
    assembly {
      indent := mload(0x40)
      mstore(0x40, add(indent, 0x20))
      mstore(indent, depth)
      mstore(add(indent, 0x20), xor(NL_SPACES, shr(mul(depth, 8), NL_SPACES_MASK)))
    }
  }

  function writeLine(SerializeContext memory context, string memory ln) internal pure {
    if (context.output.length() > 0) {
      context.output = string.concat(context.output, newLineIndent(context.depth), ln);
    } else {
      context.output = string.concat("\n", ln);
    }
  }

  function intoBlock(SerializeContext memory context, string memory label) internal pure {
    context.writeLine(label);
    context.depth++;
  }

  function outofBlock(SerializeContext memory context) internal pure {
    // next write will add newline
    context.depth++;
  }

  function finishBlock(SerializeContext memory context, string memory label) internal pure {
    context.writeLine(label);
    context.depth++;
  }

  function dump(SerializeContext memory context) internal pure {
    // console2.log(string.concat(context.output, "\n"));
    context.output = "";
    context.depth = 0;
  }

  function length(string memory str) internal pure returns (uint256 len) {
    assembly {
      len := mload(str)
    }
  }

  function labeled(
    string memory label,
    string memory value
  ) internal pure returns (string memory ret) {
    ret = string.concat(label, ": ", value);
  }

  function addCommaSeparator()

  function tuple(string memory inner) internal pure returns (string memory ret) {
    ret = string.concat("(", inner, ")");
  }
}
