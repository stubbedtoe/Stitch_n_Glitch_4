import * as $int from "../../../gleam_stdlib/gleam/int.mjs";
import * as $list from "../../../gleam_stdlib/gleam/list.mjs";
import * as $string from "../../../gleam_stdlib/gleam/string.mjs";
import { List$Empty$const as $List$Empty$const, prepend as listPrepend } from "../../gleam.mjs";

function pad10(value) {
  return $string.pad_start($int.to_string(value), 10, "0");
}

function object(number, contents) {
  return (($int.to_string(number) + " 0 obj\n") + contents) + "\nendobj\n";
}

/**
 * PDF literal strings may only carry printable ASCII here; anything else is
 * replaced so the byte offsets below stay exact (string.byte_size == length
 * for pure-ASCII content).
 * 
 * @ignore
 */
function escape_text(value) {
  let _pipe = value;
  let _pipe$1 = $string.to_utf_codepoints(_pipe);
  let _pipe$2 = $list.map(
    _pipe$1,
    (codepoint) => {
      let char = $string.from_utf_codepoints(
        listPrepend(codepoint, $List$Empty$const),
      );
      let byte_size = $string.byte_size(char);
      let is_printable = (((byte_size === 1) && (char !== "(")) && (char !== ")")) && (char !== "\\");
      if (is_printable) {
        return char;
      } else {
        return "?";
      }
    },
  );
  return $string.join(_pipe$2, "");
}

export function build(document_name) {
  let header = "%PDF-1.4\n";
  let text = ("BT /F1 18 Tf 40 80 Td (" + escape_text(document_name)) + ") Tj ET";
  let objects = listPrepend(
    object(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    listPrepend(
      object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
      listPrepend(
        object(
          3,
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] " + "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        ),
        listPrepend(
          object(
            4,
            ((("<< /Length " + $int.to_string($string.byte_size(text))) + " >>\nstream\n") + text) + "\nendstream",
          ),
          listPrepend(
            object(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
            $List$Empty$const,
          ),
        ),
      ),
    ),
  );
  let body = $string.join(objects, "");
  let $ = $list.fold(
    objects,
    [$List$Empty$const, $string.byte_size(header)],
    (acc, object) => {
      let entries = acc[0];
      let offset = acc[1];
      return [
        listPrepend(pad10(offset), entries),
        offset + $string.byte_size(object),
      ];
    },
  );
  let xrefs = $[0];
  let xref_offset = $string.byte_size(header) + $string.byte_size(body);
  return ((((((((((header + body) + "xref\n0 ") + $int.to_string(
    $list.length(objects) + 1,
  )) + "\n0000000000 65535 f \n") + (() => {
    let _pipe = $list.reverse(xrefs);
    return $string.join(_pipe, " 00000 n \n");
  })()) + " 00000 n \n") + "trailer\n<< /Size ") + $int.to_string(
    $list.length(objects) + 1,
  )) + " /Root 1 0 R >>\nstartxref\n") + $int.to_string(xref_offset)) + "\n%%EOF\n";
}
