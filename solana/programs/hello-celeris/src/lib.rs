use anchor_lang::prelude::*;
use std::str;

declare_id!("38rmX7Q51ptVmF1nEDuq14DNu57Pgy18q9QszcmhqB1o");

const MAX_GREETING_ENTRIES: usize = 100;
const MAX_USERNAME_BYTES: usize = 32;
const MAX_MESSAGE_SUFFIX_BYTES: usize = 20;
const MAX_MESSAGE_BYTES: usize = MAX_USERNAME_BYTES + MAX_MESSAGE_SUFFIX_BYTES;

#[program]
pub mod hello_celeris {
    use super::*;

    pub fn initialize_app(ctx: Context<InitializeApp>, app_id_hash: [u8; 32]) -> Result<()> {
        let state = &mut ctx.accounts.app_state;
        state.app_id_hash = app_id_hash;
        state.authority = ctx.accounts.authority.key();
        state.entry_count = 0;
        state.entries = Vec::new();
        Ok(())
    }

    pub fn say_hello(
        ctx: Context<SayHello>,
        player_wallet: Pubkey,
        username: String,
    ) -> Result<()> {
        let username_bytes = username.as_bytes();
        require!(!username_bytes.is_empty(), HelloCelerisError::EmptyUsername);
        require!(
            username_bytes.len() <= MAX_USERNAME_BYTES,
            HelloCelerisError::UsernameTooLong
        );

        let state = &mut ctx.accounts.app_state;
        require_keys_eq!(
            ctx.accounts.authority.key(),
            state.authority,
            HelloCelerisError::UnauthorizedAuthority
        );
        require!(
            state.entries.len() < MAX_GREETING_ENTRIES,
            HelloCelerisError::GreetingCapacityReached
        );

        let message = format!("{} says Hello Celeris!", username);
        state.entries.push(GreetingEntry {
            player_wallet,
            username_length: username_bytes.len() as u8,
            message: encode_fixed_message(&message),
            created_at_unix_seconds: Clock::get()?.unix_timestamp,
        });
        state.entry_count = state.entries.len() as u16;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32])]
pub struct InitializeApp<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + AppState::INIT_SPACE,
        seeds = [b"app_state", app_id_hash.as_ref()],
        bump
    )]
    pub app_state: Account<'info, AppState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SayHello<'info> {
    #[account(
        mut,
        has_one = authority,
        seeds = [b"app_state", app_state.app_id_hash.as_ref()],
        bump
    )]
    pub app_state: Account<'info, AppState>,
    pub authority: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct AppState {
    pub app_id_hash: [u8; 32],
    pub authority: Pubkey,
    pub entry_count: u16,
    #[max_len(MAX_GREETING_ENTRIES)]
    pub entries: Vec<GreetingEntry>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct GreetingEntry {
    pub player_wallet: Pubkey,
    pub username_length: u8,
    pub message: [u8; MAX_MESSAGE_BYTES],
    pub created_at_unix_seconds: i64,
}

impl GreetingEntry {
    pub fn username(&self) -> Result<String> {
        let bytes = self
            .message
            .get(..self.username_length as usize)
            .ok_or(HelloCelerisError::MessageDecodeFailed)?;
        let text = str::from_utf8(bytes).map_err(|_| HelloCelerisError::MessageDecodeFailed)?;
        Ok(text.to_string())
    }

    pub fn message(&self) -> Result<String> {
        let message_length = self.username_length as usize + MAX_MESSAGE_SUFFIX_BYTES;
        let bytes = self
            .message
            .get(..message_length)
            .ok_or(HelloCelerisError::MessageDecodeFailed)?;
        let text = str::from_utf8(bytes).map_err(|_| HelloCelerisError::MessageDecodeFailed)?;
        Ok(text.to_string())
    }
}

#[error_code]
pub enum HelloCelerisError {
    #[msg("username must not be empty")]
    EmptyUsername,
    #[msg("username must be at most 32 UTF-8 bytes")]
    UsernameTooLong,
    #[msg("authority does not match the app sponsor wallet")]
    UnauthorizedAuthority,
    #[msg("the app state account already contains 100 greetings")]
    GreetingCapacityReached,
    #[msg("failed to decode greeting message")]
    MessageDecodeFailed,
}

fn encode_fixed_message(message: &str) -> [u8; MAX_MESSAGE_BYTES] {
    let mut bytes = [0u8; MAX_MESSAGE_BYTES];
    let message_bytes = message.as_bytes();
    bytes[..message_bytes.len()].copy_from_slice(message_bytes);
    bytes
}
