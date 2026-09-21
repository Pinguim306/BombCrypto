class_name Scenarios
## Builds a MockServer from res://resources/fixtures/state_<name>.json (design §9).
## `flaky` and `expired` reuse the default fixture; their behaviour lives in MockBackend.set_scenario.

const NAMES: Array[String] = ["default", "empty", "rich", "claimable", "exhausted", "almost_cleared", "flaky", "expired"]
const FIXTURE_ALIAS := {"flaky": "default", "expired": "default"}
const FIXTURE_DIR := "res://resources/fixtures"


static func is_valid(name: String) -> bool:
	return NAMES.has(name)


static func fixture_name(name: String) -> String:
	var n := name if is_valid(name) else "default"
	return String(FIXTURE_ALIAS.get(n, n))


static func fixture_path(name: String) -> String:
	return "%s/state_%s.json" % [FIXTURE_DIR, fixture_name(name)]


## Reads and parses a fixture; {} when unreadable/invalid (error pushed).
static func load_fixture(name: String) -> Dictionary:
	var path := fixture_path(name)
	var text := FileAccess.get_file_as_string(path)
	if text.is_empty():
		push_error("Scenarios: cannot read fixture %s (%s)" % [path, error_string(FileAccess.get_open_error())])
		return {}
	var d: Variant = JSON.parse_string(text)
	if typeof(d) != TYPE_DICTIONARY:
		push_error("Scenarios: fixture %s is not a JSON object" % path)
		return {}
	return d


static func build(name: String) -> MockServer:
	if not is_valid(name):
		push_warning("Scenarios: unknown scenario '%s', using default" % name)
		name = "default"
	var seed := NAMES.find(name) + 1
	var server := MockServer.new(seed)
	var d := load_fixture(name)
	if d.is_empty() or not server.load_state(d):
		push_error("Scenarios: falling back to generated state for '%s'" % name)
		server.reset_default()
	return server
