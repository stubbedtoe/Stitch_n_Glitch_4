//// Generated from specs/m2-chart-core.allium — slice m2-editor-tools:
//// the F-014 LibrarySearched rule and the LibrarySearch surface (deferred
//// from M1's LibraryBrowser guidance): local name matching over the pattern
//// library; the query and results never leave the device.
////
//// RED baseline: the M2 implementation (src/sng/tools.gleam, search half)
//// does not exist yet — the suite fails to compile on the missing module.
//// See test/red-baseline-m2-editor-tools.txt.
////
//// Matching note: the spec pins "matches on document names" without fixing
//// case/whitespace semantics; these tests assert substring matching in the
//// query's exact case and flag the rest as an implementation choice.

import gleam/list
import gleeunit/should
import sng/store as st
import sng/tools as tools
import sng/types

fn doc_named(s: st.Store, name: String, now: Int) -> #(st.Store, types.PatternDocument) {
  let assert Ok(#(s, doc)) = st.create_blank(s, 4, 3, now)
  let assert Ok(s) = st.rename(s, doc.id, name, now)
  #(s, doc)
}

// -- rule LibrarySearched ---------------------------------------------------------

pub fn library_searched_test() {
  // rule-success + rule-entity-creation: a SearchResults entry carries the
  // query, the matched documents and the execution time.
  let #(s0, rose) = doc_named(st.new(), "Rose Garden", 1000)
  let #(s1, _cottage) = doc_named(s0, "Cottage", 2000)

  let assert Ok(results) = tools.search_library(s1, "Rose", 3000)
  results.query |> should.equal("Rose")
  results.returned_at |> should.equal(3000)
  // Only the matching document is returned.
  results.matches |> list.length |> should.equal(1)
  let assert Ok(entry) = list.first(results.matches)
  entry.document_id |> should.equal(rose.id)

  // surface-exposure.LibrarySearch: each match exposes the document's name,
  // thumbnail and last_edited.
  entry.name |> should.equal("Rose Garden")
  entry.last_edited |> should.equal(1000)
  entry.thumbnail.generated_at |> should.equal(3000)
}

pub fn library_search_matches_multiple_documents_test() {
  let #(s0, rose) = doc_named(st.new(), "Rose Garden", 1000)
  let #(s1, rosebud) = doc_named(s0, "Rosebud", 2000)
  let #(s2, cottage) = doc_named(s1, "Cottage", 3000)

  let assert Ok(results) = tools.search_library(s2, "Rose", 4000)
  results.matches |> list.length |> should.equal(2)
  let ids = list.map(results.matches, fn(entry) { entry.document_id })
  ids |> list.contains(rose.id) |> should.be_true
  ids |> list.contains(rosebud.id) |> should.be_true
  ids |> list.contains(cottage.id) |> should.be_false
}

pub fn library_search_no_matches_test() {
  let #(s, _doc) = doc_named(st.new(), "Cottage", 1000)
  let assert Ok(results) = tools.search_library(s, "XYZ", 2000)
  results.matches |> should.equal([])
  results.query |> should.equal("XYZ")
  results.returned_at |> should.equal(2000)
}

pub fn library_search_empty_query_fails_test() {
  // rule-failure.LibrarySearched.1 / surface-provides.LibrarySearch guard:
  // requires query != "".
  let #(s, _doc) = doc_named(st.new(), "Cottage", 1000)
  tools.search_library(s, "", 2000) |> should.equal(Error(tools.EmptyQuery))
}

pub fn library_search_anonymous_actor_test() {
  // surface-actor.LibrarySearch: callable with no user identity
  // (M1 anonymous mode, AC-F001-02); nothing is transmitted.
  let #(s, _doc) = doc_named(st.new(), "Cottage", 1000)
  let assert Ok(results) = tools.search_library(s, "Cottage", 2000)
  results.matches |> list.length |> should.equal(1)
}
