extends Node
## Config autoload — constants mirrored from the server engine (display-only
## estimates must match server/src/game/engine.ts) plus runtime flags parsed
## from the command line (editor/native) or pushed by the host page (web).

const POLL_MS := 2000                                   # MiningScene.ts POLL_MS
const BACKOFF_MS := [2000, 2000, 4000, 8000, 15000]     # index = consecutive failures
const OFFLINE_AFTER_FAILURES := 3
const REQUEST_TIMEOUT_MS := 15000
const CLAIM_TIMEOUT_MS := 300000
const DAILY_REFRESH_MS := 300000

const PER_PAGE := 4
const MAX_HOUSE_LINES := 6
const DAILY_ATTEMPT_LIMIT := 10                         # adventure.ts DAILY_ATTEMPT_LIMIT

# engine.ts: a working hero throws a bomb every 4000/(1+speed/100) ms and
# earns power * 0.075 BLAST per bomb → BLAST/hour = 67.5 * power * (1+speed/100)
const BOMB_BASE_INTERVAL_MS := 4000
const BLAST_PER_HP := 0.075
const RATE_K := 67.5

const RARITY_NAMES := ["Common", "Rare", "S.Rare", "Epic", "Legend", "Mythic"]
const RARITY_COLORS: Array[Color] = [
	Color("9e9e9e"), Color("66bb6a"), Color("42a5f5"),
	Color("ab47bc"), Color("ffa726"), Color("ef5350"),
]
const STONE: Array[Color] = [Color("8d6e63"), Color("78909c"), Color("5d4037")]
const ORE: Array[Color] = [Color("ffca28"), Color("4fc3f7"), Color("ef5350")]

# ---- runtime flags ----
var is_web: bool = false
var mock_forced: bool = false       # --mock (editor/native) — web uses ?mock=1 via the host
var fx_enabled: bool = true         # --no-fx or headless
var fancy_lights: bool = true       # off on web_android / web_ios
var reduced_motion: bool = false    # host prefers-reduced-motion
var scenario: String = "default"    # --scenario=<name> (mock fixtures)
var dev_tools: bool = false         # --dev, or any non-web run (editor F1 panel)
var bomb_mode: String = "predict"   # "predict" | "reconcile"

# ---- host config (web) ----
var server_url: String = ""
var chain_id: int = 4663
var explorer_url: String = "https://robinhoodchain.blockscout.com"
var mobile_wallet: bool = false
var network_name: String = "Robinhood Chain"
var build_id: String = ""
var host_mock: bool = false


func _init() -> void:
	is_web = OS.has_feature("web")
	for a: String in OS.get_cmdline_user_args():
		if a == "--mock":
			mock_forced = true
		elif a == "--no-fx":
			fx_enabled = false
		elif a == "--dev":
			dev_tools = true
		elif a.begins_with("--scenario="):
			scenario = a.substr("--scenario=".length())
		elif a.begins_with("--bomb-mode="):
			bomb_mode = a.substr("--bomb-mode=".length())
	if DisplayServer.get_name() == "headless":
		fx_enabled = false
	fancy_lights = not (OS.has_feature("web_android") or OS.has_feature("web_ios"))
	# the editor / native runs always get the F1 dev panel (mock data only)
	dev_tools = dev_tools or not is_web


## Applies mb.configJson() from the host page (web only).
func apply_host_config(c: Dictionary) -> void:
	host_mock = bool(c.get("mock", false))
	reduced_motion = bool(c.get("reducedMotion", false))
	if c.has("chainId"):
		chain_id = int(c.get("chainId"))
	server_url = str(c.get("serverUrl", server_url))
	explorer_url = str(c.get("explorerUrl", explorer_url))
	mobile_wallet = bool(c.get("mobileWalletEnabled", false))
	network_name = str(c.get("networkName", network_name))
	build_id = str(c.get("buildId", build_id))


## 0.0 under reduced motion, else 1.0 — every juice amount is multiplied by it.
func juice_scale() -> float:
	return 0.0 if reduced_motion else 1.0
