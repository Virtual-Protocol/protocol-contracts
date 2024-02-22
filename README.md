
# Virtual Protocol Contracts



| Contract | Purpose | Access Control | Upgradable |
| ------ | ------ | ------ | ------ |
| veVirtualToken | This is a non-transferrable voting token to be used to vote on Virtual Protocol DAO and Virtual Genesis DAO  | Ownable | N |
| VirtualProtocolDAO | Regular DAO to maintain the VIRTUAL ecosystem | - | N | 
| VirtualGenesisDAO | Used to vote for instantiation of a VIRTUAL. This DAO allows early execution of proposal as soon as quorum (10k votes) is reached. | - | N |
| PersonaFactory | Handles the application & instantiation of a new VIRTUAL. References to TBA registry, VIRTUAL DAO/Token implementation and Persona NFT vault contracts are stored here. | Roles : DEFAULT_ADMIN_ROLE, WITHDRAW_ROLE | Y | 
| PersonaNft | This is the main registry for Persona, Core and Validator. Used to generate ICV wallet address.  | Roles: DEFAULT_ADMIN_ROLE, VALIDATOR_ADMIN_ROLE, MINTER_ROLE | N |
| ContributionNft | Each contribution will mint a new ContributionNft. Anyone can propose a new contribution at the VIRTUAL DAO and mint token using the proposal Id.  | - | N |
| ServiceNft | Accepted contribution will mint a ServiceNft, restricted to only VIRTUAL DAO can mint a ServiceNft. User can query the latest service NFT for a VIRTUAL CORE. | - | N |
| PersonaToken | This is implementation contract for VIRTUAL staking. PersonaFactory will clone this during VIRTUAL instantiation. Staked token is non-transferable. | - | N |
| PersonaDAO | This is implementation contract for VIRTUAL specific DAO. PersonaFactory will clone this during VIRTUAL instantiation. It holds the maturity score for each core service. | - | N |
| PersonaReward | This is reward distribution center. | Roles: GOV_ROLE, TOKEN_SAVER_ROLE | Y |
| TimeLockStaking | Allows user to stake their $VIRTUAL in exchange for $sVIRTUAL | Roles: GOV_ROLE, TOKEN_SAVER_ROLE | N |


# Main Activities
## VIRTUAL Genesis
1. Submit a new application at **PersonaFactory** 
	a. It will transfer $VIRTUAL to PersonaFactory
2. Propose at **VirtualGenesisDAO** (action = ```VirtualFactory.executeApplication``` )
3. Start voting at **VirtualGenesisDAO**
4. Execute proposal at  **VirtualGenesisDAO**  , it will do following:
	a. Clone **PersonaToken**
	b. Clone **PersonaDAO**
	c. Mint **PersonaNft**
	d. Stake $VIRTUAL -> $PERSONA (depending on the symbol sent to application)
	e. Create **TBA** with **PersonaNft**
	

## Submit Contribution
1. Create proposal at **PersonaDAO** (action = ServiceNft.mint)
2. Mint **ContributionNft** , it will authenticate by checking whether sender is the proposal's proposer.


## Upgrading Core
1. Validator vote for contribution proposal at **PersonaDAO**
2. Execute proposal at **PersonaDAO**, it will mint a **ServiceNft**, and trigger following actions:
	a. Update maturity score
	b. Update VIRTUAL core service id.


## Distribute Reward
1. On daily basis, protocol backend will conclude daily profits into a single amount.
2. Protocol backend calls **PersonaReward**.distributeRewards , triggering following:
	a. Transfer $VIRTUAL into **PersonaReward** 
	b. Account & update claimable amounts for: Protocol, Stakers, Validators, Dataset Contributors, Model Contributors
	
	
## Claim Reward
1. Protocol calls **PersonaReward**.withdrawProtocolRewards
2. Stakers, Validators, Dataset Contributors, Model Contributors calls **PersonaReward**.claimAllRewards


## Staking VIRTUAL
1. Call **PersonaToken**.stake , pass in the validator that you would like to delegate your voting power to. It will take in $sVIRTUAL and mint $*PERSONA* to you.
2. Call **PersonaToken**.withdraw to withdraw , will burn your $*PERSONA* and return $sVIRTUAL to you.