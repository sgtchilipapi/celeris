module hello_celeris::hello_celeris;

use std::string::{Self, String};
use std::vector;
use sui::clock::{Self, Clock};
use sui::object::{Self, ID, UID};
use sui::transfer;
use sui::tx_context::{Self, TxContext};

const E_APP_AUTHORITY_MISMATCH: u64 = 1;
const E_USERNAME_EMPTY: u64 = 2;
const E_USERNAME_TOO_LONG: u64 = 3;
const E_MAX_ENTRIES_REACHED: u64 = 4;

const MAX_GREETING_ENTRIES: u64 = 100;
const MAX_USERNAME_UTF8_BYTES: u64 = 32;
const HELLO_SUFFIX: vector<u8> = b" says Hello Celeris!";

public struct AppAuthorityCap has key, store {
    id: UID,
    app_state_id: ID,
}

public struct GreetingEntry has copy, drop, store {
    player_wallet: address,
    username: String,
    message: String,
    created_timestamp_ms: u64,
}

public struct AppState has key, store {
    id: UID,
    app_id: vector<u8>,
    entry_count: u64,
    entries: vector<GreetingEntry>,
}

public entry fun initialize_app(app_id: String, ctx: &mut TxContext) {
    let (app_state, authority_cap) = create_app(app_id, ctx);

    transfer::public_transfer(authority_cap, tx_context::sender(ctx));
    transfer::share_object(app_state);
}

public entry fun say_hello(
    authority_cap: &AppAuthorityCap,
    app_state: &mut AppState,
    clock: &Clock,
    username: String,
    ctx: &TxContext,
) {
    say_hello_impl(authority_cap, app_state, clock, username, ctx);
}

fun create_app(app_id: String, ctx: &mut TxContext): (AppState, AppAuthorityCap) {
    let app_state = AppState {
        id: object::new(ctx),
        app_id: string::into_bytes(app_id),
        entry_count: 0,
        entries: vector[],
    };
    let authority_cap = AppAuthorityCap {
        id: object::new(ctx),
        app_state_id: object::id(&app_state),
    };

    (app_state, authority_cap)
}

fun say_hello_impl(
    authority_cap: &AppAuthorityCap,
    app_state: &mut AppState,
    clock: &Clock,
    username: String,
    ctx: &TxContext,
) {
    assert!(authority_cap.app_state_id == object::id(app_state), E_APP_AUTHORITY_MISMATCH);

    let username_length = string::length(&username);
    assert!(username_length > 0, E_USERNAME_EMPTY);
    assert!(username_length <= MAX_USERNAME_UTF8_BYTES, E_USERNAME_TOO_LONG);
    assert!(app_state.entry_count < MAX_GREETING_ENTRIES, E_MAX_ENTRIES_REACHED);

    let message = render_message(copy username);
    let entry = GreetingEntry {
        player_wallet: tx_context::sender(ctx),
        username,
        message,
        created_timestamp_ms: clock::timestamp_ms(clock),
    };

    vector::push_back(&mut app_state.entries, entry);
    app_state.entry_count = app_state.entry_count + 1;
}

fun render_message(username: String): String {
    let mut message = username;
    string::append(&mut message, string::utf8(HELLO_SUFFIX));
    message
}

#[test_only]
fun destroy_for_testing(app_state: AppState, authority_cap: AppAuthorityCap, clock: Clock) {
    let AppState {
        id: app_state_id,
        app_id: _,
        entry_count: _,
        entries: _,
    } = app_state;
    let AppAuthorityCap {
        id: authority_cap_id,
        app_state_id: _,
    } = authority_cap;

    object::delete(app_state_id);
    object::delete(authority_cap_id);
    clock::destroy_for_testing(clock);
}

#[test]
fun initialize_app_creates_state_and_authority_cap() {
    let mut ctx = tx_context::new_from_hint(@0xA11CE, 7, 0, 0, 0);
    let (app_state, authority_cap) = create_app(string::utf8(b"app-123"), &mut ctx);
    let clock = clock::create_for_testing(&mut ctx);

    assert!(app_state.app_id == b"app-123");
    assert!(app_state.entry_count == 0);
    assert!(vector::length(&app_state.entries) == 0);
    assert!(authority_cap.app_state_id == object::id(&app_state));

    destroy_for_testing(app_state, authority_cap, clock);
}

#[test]
fun say_hello_records_sender_and_canonical_message() {
    let mut ctx = tx_context::new_from_hint(@0xB0B, 8, 0, 0, 0);
    let (mut app_state, authority_cap) = create_app(string::utf8(b"app-456"), &mut ctx);
    let mut clock = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock, 4242);

    say_hello_impl(&authority_cap, &mut app_state, &clock, string::utf8(b"Sam"), &ctx);

    let first_entry = vector::borrow(&app_state.entries, 0);
    assert!(first_entry.player_wallet == @0xB0B);
    assert!(string::into_bytes(copy first_entry.username) == b"Sam");
    assert!(string::into_bytes(copy first_entry.message) == b"Sam says Hello Celeris!");
    assert!(first_entry.created_timestamp_ms == 4242);
    assert!(app_state.entry_count == 1);

    destroy_for_testing(app_state, authority_cap, clock);
}

#[test, expected_failure(abort_code = E_MAX_ENTRIES_REACHED)]
fun say_hello_rejects_the_101st_greeting() {
    let mut ctx = tx_context::new_from_hint(@0xCAFE, 9, 0, 0, 0);
    let (mut app_state, authority_cap) = create_app(string::utf8(b"app-789"), &mut ctx);
    let clock = clock::create_for_testing(&mut ctx);
    let mut i = 0;

    while (i < MAX_GREETING_ENTRIES) {
        say_hello_impl(&authority_cap, &mut app_state, &clock, string::utf8(b"Sam"), &ctx);
        i = i + 1;
    };

    say_hello_impl(&authority_cap, &mut app_state, &clock, string::utf8(b"Sam"), &ctx);

    destroy_for_testing(app_state, authority_cap, clock);
}
