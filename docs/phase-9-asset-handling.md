Phase 9 makes asset handling explicit in the success path.

Current MVP behavior:
- on successful transaction resolution, the SaaS captures credits
- then it creates an `Asset` record
- the asset is linked to `userId`, `appId`, and the successful `transactionId`
- asset status is always `held` in MVP

Implementation note:
- asset creation now lives behind a dedicated `AssetService`
- failed transactions do not create assets and instead release reserved credits
