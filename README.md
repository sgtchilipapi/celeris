# celeris
Celeris handles how players pay for game actions and execute them on-chain so players don't need wallets.

#### TLDR;

Celeris lets developers:

-onboard players instantly

-monetize through credits

-execute on-chain actions without infra

Build the game. Celeris handles money and execution.Summary


### Overview

Celeris is a backend service for game developers.

It provides:

user identity
credit based payments
action authorization
transaction execution
asset handling

Developers keep full control of game logic. Celeris handles money and execution.

### What it solves

players drop off due to wallet setup and funding
payments and credit systems are complex to build
on-chain execution requires relayers and gas handling
transaction flows can break gameplay

Celeris removes these problems.

### How it works

Player starts game
→ signs in through Celeris
→ buys credits

Player performs an action
→ Celeris checks credits and reserves cost
→ Celeris calls developer server

Developer validates action
→ builds transaction
→ returns transaction

Celeris verifies and executes transaction
→ updates credits
→ records asset
→ returns result to game

### Core concepts
#### UserId

Celeris generates the canonical userId.
Developers use this as the player identifier.

#### Credits

Players purchase credits using card payments.
Developers specify pricing and credit points.
Actions consume credits.

#### Actions

Developers define actions and their cost (i.e. Item transfers, mints, etc.).

#### PendingAction

Represents a reserved and authorized action before execution.

#### Execution

Celeris verifies developer transactions and submits them on-chain.

#### Assets

Assets are minted and held in custody, mapped to userId.
