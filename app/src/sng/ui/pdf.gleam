//// Placeholder PDF export for M1 (rule ExportPdfPlaceholder): a minimal,
//// structurally valid single-page PDF assembled locally in Gleam. Nothing
//// is transmitted (contract LocalOnlyBoundary); the bytes go straight to a
//// local download via browser_ffi.download_text.

import gleam/int
import gleam/list
import gleam/string

pub fn build(document_name: String) -> String {
  let header = "%PDF-1.4\n"
  let text = "BT /F1 18 Tf 40 80 Td (" <> escape_text(document_name) <> ") Tj ET"
  let objects = [
    object(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    object(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] "
        <> "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    ),
    object(
      4,
      "<< /Length " <> int.to_string(string.byte_size(text)) <> " >>\nstream\n"
        <> text <> "\nendstream",
    ),
    object(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ]
  let body = string.join(objects, "")
  let #(xrefs, _) =
    list.fold(objects, #([], string.byte_size(header)), fn(acc, object) {
      let #(entries, offset) = acc
      #([pad10(offset), ..entries], offset + string.byte_size(object))
    })
  let xref_offset = string.byte_size(header) + string.byte_size(body)
  header
  <> body
  <> "xref\n0 "
  <> int.to_string(list.length(objects) + 1)
  <> "\n0000000000 65535 f \n"
  <> list.reverse(xrefs) |> string.join(" 00000 n \n")
  <> " 00000 n \n"
  <> "trailer\n<< /Size "
  <> int.to_string(list.length(objects) + 1)
  <> " /Root 1 0 R >>\nstartxref\n"
  <> int.to_string(xref_offset)
  <> "\n%%EOF\n"
}

fn object(number: Int, contents: String) -> String {
  int.to_string(number) <> " 0 obj\n" <> contents <> "\nendobj\n"
}

fn pad10(value: Int) -> String {
  string.pad_start(int.to_string(value), 10, "0")
}

/// PDF literal strings may only carry printable ASCII here; anything else is
/// replaced so the byte offsets below stay exact (string.byte_size == length
/// for pure-ASCII content).
fn escape_text(value: String) -> String {
  value
  |> string.to_utf_codepoints
  |> list.map(fn(codepoint) {
    let char = string.from_utf_codepoints([codepoint])
    let byte_size = string.byte_size(char)
    let is_printable = byte_size == 1 && char != "(" && char != ")" && char != "\\"
    case is_printable {
      True -> char
      False -> "?"
    }
  })
  |> string.join("")
}
