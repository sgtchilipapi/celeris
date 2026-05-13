use anchor_lang::prelude::Pubkey;
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use anchor_lang::solana_program::system_program;
use hello_celeris::accounts::{
    InitializeApp as InitializeAppAccounts, SayHello as SayHelloAccounts,
};
use hello_celeris::instruction::{
    InitializeApp as InitializeAppInstruction, SayHello as SayHelloInstruction,
};
use hello_celeris::{AppState, ID};
use solana_program_test::{tokio, BanksClientError, ProgramTest};
use solana_sdk::account::ReadableAccount;
use solana_sdk::hash::hash;
use solana_sdk::instruction::Instruction;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::transaction::Transaction;

const APP_ID: &str = "123e4567-e89b-12d3-a456-426614174000";

#[tokio::test]
async fn initialize_app_sets_expected_authority() {
    let mut context = program_test().start_with_context().await;
    let authority = Keypair::new();

    fund_authority(&mut context, &authority).await;

    let app_id_hash = hash_app_id(APP_ID);
    let state_pda = derive_state_pda(&app_id_hash);

    process_transaction(
        &mut context,
        &[build_initialize_app_instruction(
            authority.pubkey(),
            app_id_hash,
            state_pda,
        )],
        &[&authority],
    )
    .await
    .unwrap();

    let state = fetch_app_state(&mut context, state_pda).await;
    assert_eq!(state.app_id_hash, app_id_hash);
    assert_eq!(state.authority, authority.pubkey());
    assert_eq!(state.entry_count, 0);
    assert!(state.entries.is_empty());
}

#[tokio::test]
async fn say_hello_appends_canonical_greeting_with_timestamp() {
    let mut context = program_test().start_with_context().await;
    let authority = Keypair::new();
    let player_wallet = Keypair::new().pubkey();

    fund_authority(&mut context, &authority).await;

    let app_id_hash = hash_app_id(APP_ID);
    let state_pda = derive_state_pda(&app_id_hash);

    process_transaction(
        &mut context,
        &[build_initialize_app_instruction(
            authority.pubkey(),
            app_id_hash,
            state_pda,
        )],
        &[&authority],
    )
    .await
    .unwrap();

    process_transaction(
        &mut context,
        &[build_say_hello_instruction(
            authority.pubkey(),
            state_pda,
            player_wallet,
            "Sam",
        )],
        &[&authority],
    )
    .await
    .unwrap();

    let state = fetch_app_state(&mut context, state_pda).await;
    assert_eq!(state.entry_count, 1);
    assert_eq!(state.entries.len(), 1);

    let entry = &state.entries[0];
    assert_eq!(entry.player_wallet, player_wallet);
    assert_eq!(entry.username().unwrap(), "Sam");
    assert_eq!(entry.message().unwrap(), "Sam says Hello Celeris!");
    assert!(entry.created_at_unix_seconds >= 0);
}

#[tokio::test]
async fn say_hello_rejects_non_authority_signer() {
    let mut context = program_test().start_with_context().await;
    let authority = Keypair::new();
    let wrong_authority = Keypair::new();
    let player_wallet = Keypair::new().pubkey();

    fund_authority(&mut context, &authority).await;
    fund_authority(&mut context, &wrong_authority).await;

    let app_id_hash = hash_app_id(APP_ID);
    let state_pda = derive_state_pda(&app_id_hash);

    process_transaction(
        &mut context,
        &[build_initialize_app_instruction(
            authority.pubkey(),
            app_id_hash,
            state_pda,
        )],
        &[&authority],
    )
    .await
    .unwrap();

    let error = process_transaction(
        &mut context,
        &[build_say_hello_instruction(
            wrong_authority.pubkey(),
            state_pda,
            player_wallet,
            "Mallory",
        )],
        &[&wrong_authority],
    )
    .await
    .unwrap_err();

    assert!(matches!(error, BanksClientError::TransactionError(_)));

    let state = fetch_app_state(&mut context, state_pda).await;
    assert_eq!(state.entry_count, 0);
    assert!(state.entries.is_empty());
}

fn program_test() -> ProgramTest {
    std::env::set_var(
        "BPF_OUT_DIR",
        format!("{}/../../target/deploy", env!("CARGO_MANIFEST_DIR")),
    );
    ProgramTest::new("hello_celeris", ID, None)
}

async fn fund_authority(
    context: &mut solana_program_test::ProgramTestContext,
    authority: &Keypair,
) {
    let payer = context.payer.insecure_clone();
    let transfer = solana_sdk::system_instruction::transfer(
        &context.payer.pubkey(),
        &authority.pubkey(),
        1_000_000_000,
    );

    process_transaction(context, &[transfer], &[&payer])
        .await
        .unwrap();
}

async fn process_transaction(
    context: &mut solana_program_test::ProgramTestContext,
    instructions: &[Instruction],
    signers: &[&Keypair],
) -> Result<(), BanksClientError> {
    let recent_blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let mut all_signers = vec![&context.payer];
    all_signers.extend(signers.iter().copied());

    let transaction = Transaction::new_signed_with_payer(
        instructions,
        Some(&context.payer.pubkey()),
        &all_signers,
        recent_blockhash,
    );

    context.banks_client.process_transaction(transaction).await
}

fn build_initialize_app_instruction(
    authority: Pubkey,
    app_id_hash: [u8; 32],
    state_pda: Pubkey,
) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: InitializeAppAccounts {
            app_state: state_pda,
            authority,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: InitializeAppInstruction { app_id_hash }.data(),
    }
}

fn build_say_hello_instruction(
    authority: Pubkey,
    state_pda: Pubkey,
    player_wallet: Pubkey,
    username: &str,
) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: SayHelloAccounts {
            app_state: state_pda,
            authority,
        }
        .to_account_metas(None),
        data: SayHelloInstruction {
            player_wallet,
            username: username.to_string(),
        }
        .data(),
    }
}

async fn fetch_app_state(
    context: &mut solana_program_test::ProgramTestContext,
    state_pda: Pubkey,
) -> AppState {
    let account = context
        .banks_client
        .get_account(state_pda)
        .await
        .unwrap()
        .expect("app state account must exist");

    let mut data = account.data();
    AppState::try_deserialize(&mut data).unwrap()
}

fn hash_app_id(app_id: &str) -> [u8; 32] {
    hash(app_id.as_bytes()).to_bytes()
}

fn derive_state_pda(app_id_hash: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[b"app_state", app_id_hash], &ID).0
}
