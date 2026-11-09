import atproto/browser/dpop.{type DpopKey}
import atproto/browser/oauth/flow
import atproto/browser/oauth/resource
import atproto/browser/xrpc
import atproto_core/did as atproto_did
import atproto_core/oauth/session
import atproto_core/oauth/transport
import atproto_core/remote
import gleam/dynamic/decode.{type Decoder}
import gleam/http/response.{type Response}
import gleam/int
import gleam/javascript/promise
import gleam/json.{type Json}
import gleam/option.{type Option, None, Some}
import gleam/uri

const config_url = "http://localhost:4173/s4-config.json"

const oauth_scope = "atproto transition:generic"

@external(javascript, "./sng_spike4_ffi.mjs", "set_status")
fn set_status(text: String) -> Nil

@external(javascript, "./sng_spike4_ffi.mjs", "set_auth_url")
fn set_auth_url(url: String) -> Nil

@external(javascript, "./sng_spike4_ffi.mjs", "set_result")
fn set_result(text: String) -> Nil

@external(javascript, "./sng_spike4_ffi.mjs", "set_error")
fn set_error(text: String) -> Nil

@external(javascript, "./sng_spike4_ffi.mjs", "keep_promise")
fn keep_promise(p: promise.Promise(a)) -> promise.Promise(a)

type Config {
  Config(
    did: String,
    handle: String,
    client_id: String,
    redirect_uri: String,
    plc_directory: String,
    relay_url: String,
    collection: String,
    rkey: String,
    expected_name: String,
    expected_seed: Int,
  )
}

type Relay {
  Relay(ready: Bool, query: String)
}

type PutResult {
  PutResult(uri: String, cid: String)
}

type SpikeRecord {
  SpikeRecord(name: String, seed: Int)
}

type GetResult {
  GetResult(uri: String, cid: String, value: SpikeRecord)
}

pub fn main() -> Nil {
  let client = xrpc.fetch_client()
  set_status("Loading local S4 spike configuration…")
  let _ = load_config(client) |> keep_promise
  Nil
}

fn load_config(client: xrpc.Client) -> promise.Promise(Nil) {
  use response <- promise.await(xrpc.get(client, config_url, None))
  case response {
    Error(error) -> {
      set_error(xrpc.describe(error))
      promise.resolve(Nil)
    }
    Ok(body) ->
      case xrpc.parse(body.body, config_decoder()) {
        Error(error) -> {
          set_error(xrpc.describe(error))
          promise.resolve(Nil)
        }
        Ok(config) -> start_flow(client, config)
      }
  }
}

fn start_flow(client: xrpc.Client, config: Config) -> promise.Promise(Nil) {
  set_status("Resolving DID, discovering authorization server, pushing PAR…")
  case
    remote.parse_origin_with(config.plc_directory, remote.AllowLocalDevelopment)
  {
    Error(error) -> {
      set_error(remote.url_error_to_string(error))
      promise.resolve(Nil)
    }
    Ok(plc_directory) -> {
      use started <- promise.await(flow.start_with(
        client,
        resolver: config.plc_directory,
        identifier: config.did,
        client_id: config.client_id,
        redirect_uri: config.redirect_uri,
        scope: oauth_scope,
        client_auth: transport.PublicClient,
        plc_directory: plc_directory,
      ))

      case started {
        Error(error) -> {
          set_error(flow.flow_error_to_string(error))
          promise.resolve(Nil)
        }
        Ok(#(auth_url, pending_flow)) -> {
          set_auth_url(auth_url)
          set_status("Waiting for the PDS authorization callback relay…")
          poll_relay(client, config, pending_flow, 0)
        }
      }
    }
  }
}

fn poll_relay(
  client: xrpc.Client,
  config: Config,
  pending_flow: flow.Flow,
  attempt: Int,
) -> promise.Promise(Nil) {
  use _ <- promise.await(promise.wait(500))
  use response <- promise.await(xrpc.get(client, config.relay_url, None))

  case parse_relay(response) {
    Error(error) -> {
      set_error(error)
      promise.resolve(Nil)
    }
    Ok(None) ->
      case attempt >= 120 {
        True -> {
          set_error("timed out waiting for the OAuth callback relay")
          promise.resolve(Nil)
        }
        False -> poll_relay(client, config, pending_flow, attempt + 1)
      }
    Ok(Some(query)) -> finish_round_trip(client, pending_flow, config, query)
  }
}

fn parse_relay(
  response: Result(Response(String), xrpc.XrpcError),
) -> Result(Option(List(#(String, String))), String) {
  case response {
    Error(error) -> Error(xrpc.describe(error))
    Ok(body) ->
      case xrpc.parse(body.body, relay_decoder()) {
        Error(error) -> Error(xrpc.describe(error))
        Ok(Relay(ready: False, query: _)) -> Ok(None)
        Ok(Relay(ready: True, query:)) ->
          case uri.parse_query(query) {
            Ok(params) -> Ok(Some(params))
            Error(Nil) -> Error("could not parse callback query")
          }
      }
  }
}

fn finish_round_trip(
  client: xrpc.Client,
  pending_flow: flow.Flow,
  config: Config,
  query: List(#(String, String)),
) -> promise.Promise(Nil) {
  set_status("Exchanging the authorization code for a DPoP-bound token…")
  use authenticated <- promise.await(flow.callback(
    client,
    pending_flow,
    query,
    transport.PublicClient,
  ))

  case authenticated {
    Error(error) -> {
      set_error(flow.callback_error_to_string(error))
      promise.resolve(Nil)
    }
    Ok(flow.Authenticated(auth_session, dpop_key)) -> {
      use result <- promise.await(write_and_read(
        client,
        auth_session,
        dpop_key,
        config,
      ))

      case result {
        Ok(result_json) -> {
          set_status("PASS — OAuth and custom Lexicon round trip completed.")
          set_result(result_json)
          promise.resolve(Nil)
        }
        Error(error) -> {
          set_error(error)
          promise.resolve(Nil)
        }
      }
    }
  }
}

fn write_and_read(
  client: xrpc.Client,
  auth_session: session.VerifiedSession,
  dpop_key: DpopKey,
  config: Config,
) -> promise.Promise(Result(String, String)) {
  set_status("Writing the custom Lexicon record with DPoP-authenticated XRPC…")
  use authed_client <- promise.await(resource.client(
    client,
    session: auth_session,
    dpop_key: dpop_key,
  ))

  let did = atproto_did.to_string(session.did(auth_session))
  let pds = remote.origin_to_string(session.pds(auth_session))
  let issuer = remote.origin_to_string(session.issuer(auth_session))
  let put_url = pds <> "/xrpc/com.atproto.repo.putRecord"
  let get_url =
    pds
    <> "/xrpc/com.atproto.repo.getRecord?"
    <> uri.query_to_string([
      #("repo", did),
      #("collection", config.collection),
      #("rkey", config.rkey),
    ])

  use put_response <- promise.await(xrpc.post_json(
    authed_client,
    put_url,
    None,
    put_body(config, did),
  ))
  use put_result <- promise.await(case put_response {
    Error(error) -> promise.resolve(Error(xrpc.describe(error)))
    Ok(body) ->
      case xrpc.parse(body.body, put_decoder()) {
        Ok(value) -> promise.resolve(Ok(value))
        Error(error) -> promise.resolve(Error(xrpc.describe(error)))
      }
  })

  case put_result {
    Error(error) -> promise.resolve(Error(error))
    Ok(put) -> {
      set_status("Reading the custom Lexicon record back…")
      use get_response <- promise.await(xrpc.get(authed_client, get_url, None))
      use get_result <- promise.await(case get_response {
        Error(error) -> promise.resolve(Error(xrpc.describe(error)))
        Ok(body) ->
          case xrpc.parse(body.body, get_decoder()) {
            Ok(value) -> promise.resolve(Ok(value))
            Error(error) -> promise.resolve(Error(xrpc.describe(error)))
          }
      })

      case get_result {
        Error(error) -> promise.resolve(Error(error))
        Ok(get) ->
          case verify_round_trip(config, put, get) {
            True ->
              promise.resolve(Ok(
                json.to_string(round_trip_summary(
                  config,
                  auth_session,
                  did,
                  pds,
                  issuer,
                  put,
                  get,
                )),
              ))
            False ->
              promise.resolve(Error(
                "record read-back mismatch: expected "
                <> config.expected_name
                <> "/"
                <> int.to_string(config.expected_seed)
                <> ", got "
                <> get.value.name
                <> "/"
                <> int.to_string(get.value.seed),
              ))
          }
      }
    }
  }
}

fn put_body(config: Config, did: String) -> Json {
  json.object([
    #("repo", json.string(did)),
    #("collection", json.string(config.collection)),
    #("rkey", json.string(config.rkey)),
    #(
      "record",
      json.object([
        #("$type", json.string(config.collection)),
        #("name", json.string(config.expected_name)),
        #("seed", json.int(config.expected_seed)),
        #("createdAt", json.string("2026-11-07T00:00:00.000Z")),
      ]),
    ),
  ])
}

fn verify_round_trip(config: Config, put: PutResult, get: GetResult) -> Bool {
  put.uri == get.uri
  && put.cid == get.cid
  && get.value.name == config.expected_name
  && get.value.seed == config.expected_seed
}

fn round_trip_summary(
  config: Config,
  auth_session: session.VerifiedSession,
  did: String,
  pds: String,
  issuer: String,
  put: PutResult,
  get: GetResult,
) -> Json {
  json.object([
    #("status", json.string("done")),
    #("auth", json.string("atproto-oauth-dpop")),
    #("handle", json.string(config.handle)),
    #("did", json.string(did)),
    #("pds", json.string(pds)),
    #("issuer", json.string(issuer)),
    #("scope", json.string(session.scope(auth_session))),
    #("customCollection", json.string(config.collection)),
    #("recordKey", json.string(config.rkey)),
    #("writeUri", json.string(put.uri)),
    #("writeCid", json.string(put.cid)),
    #("readUri", json.string(get.uri)),
    #("readCid", json.string(get.cid)),
    #("readName", json.string(get.value.name)),
    #("readSeed", json.int(get.value.seed)),
    #("roundTripVerified", json.bool(True)),
  ])
}

fn config_decoder() -> Decoder(Config) {
  use did <- decode.field("did", decode.string)
  use handle <- decode.field("handle", decode.string)
  use client_id <- decode.field("clientId", decode.string)
  use redirect_uri <- decode.field("redirectUri", decode.string)
  use plc_directory <- decode.field("plcDirectory", decode.string)
  use relay_url <- decode.field("relayUrl", decode.string)
  use collection <- decode.field("collection", decode.string)
  use rkey <- decode.field("rkey", decode.string)
  use expected_name <- decode.field("expectedName", decode.string)
  use expected_seed <- decode.field("expectedSeed", decode.int)

  decode.success(Config(
    did:,
    handle:,
    client_id:,
    redirect_uri:,
    plc_directory:,
    relay_url:,
    collection:,
    rkey:,
    expected_name:,
    expected_seed:,
  ))
}

fn relay_decoder() -> Decoder(Relay) {
  use ready <- decode.field("ready", decode.bool)
  use query <- decode.optional_field("query", "", decode.string)
  decode.success(Relay(ready:, query:))
}

fn put_decoder() -> Decoder(PutResult) {
  use uri_value <- decode.field("uri", decode.string)
  use cid <- decode.field("cid", decode.string)
  decode.success(PutResult(uri: uri_value, cid: cid))
}

fn get_decoder() -> Decoder(GetResult) {
  use uri_value <- decode.field("uri", decode.string)
  use cid <- decode.field("cid", decode.string)
  use value <- decode.field("value", spike_record_decoder())
  decode.success(GetResult(uri: uri_value, cid: cid, value: value))
}

fn spike_record_decoder() -> Decoder(SpikeRecord) {
  use name <- decode.field("name", decode.string)
  use seed <- decode.field("seed", decode.int)
  decode.success(SpikeRecord(name:, seed:))
}
