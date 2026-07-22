import Phaser from "phaser";
import { formatEther } from "viem";
import { connectedAddress, signMessage } from "../web3/wallet";
import { referralStats, claimReferral } from "../web3/gacha";
import { GACHA_ENABLED, SERVER_URL } from "../config";
import { registerPixelArt } from "../art/pixelart";
import { drawPanel, drawRibbon, makeButton, Button } from "../art/ui";

const ALIAS_RE = /^[a-zA-Z0-9_-]{3,20}$/;

/** The message the wallet signs to prove ownership when claiming an alias. */
function aliasClaimMessage(alias: string, address: string): string {
  return `MinerBlast referral alias\nalias: ${alias.toLowerCase()}\naddress: ${address.toLowerCase()}`;
}

function shortErr(e: unknown): string {
  return String((e as Error)?.message ?? e ?? "error").split("\n")[0].slice(0, 100);
}

/** Referral program, in-game tab. Shows the player's personal invite link
 *  (with custom alias), live earnings/invites/pending, and a claim button.
 *  Holds no authority — the split is enforced on-chain by the gacha. */
export class ReferralsScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;
  private linkText!: Phaser.GameObjects.Text;
  private earnedText!: Phaser.GameObjects.Text;
  private invitesText!: Phaser.GameObjects.Text;
  private pendingText!: Phaser.GameObjects.Text;
  private pctText!: Phaser.GameObjects.Text;
  private claimBtn!: Button;
  private nameBtn!: Button;
  private alias: string | null = null;
  private link = "";

  constructor() {
    super("referrals");
  }

  create() {
    this.alias = null;
    this.link = "";
    registerPixelArt(this);
    this.add.tileSprite(0, 0, 800, 600, "cave").setOrigin(0).setAlpha(0.5);

    drawRibbon(this, 400, 34, "REFERRALS", 220);
    const back = makeButton(this, 740, 34, "Back", { width: 90, height: 34, color: 0x37474f });
    back.onClick(() => this.scene.start("mining"));

    // intro
    this.add.text(400, 82, "Invite friends — earn a share of the ETH they spend on chests.", {
      fontFamily: "monospace", fontSize: "13px", color: "#b0bec5",
    }).setOrigin(0.5);
    this.pctText = this.add.text(400, 104, "", {
      fontFamily: "monospace", fontSize: "13px", color: "#81c784", fontStyle: "bold",
    }).setOrigin(0.5);

    // --- your link panel ---
    drawPanel(this, 60, 128, 680, 128);
    this.add.text(80, 144, "YOUR INVITE LINK", {
      fontFamily: "monospace", fontSize: "12px", color: "#78909c", fontStyle: "bold",
    });
    this.linkText = this.add.text(80, 172, "connect to load...", {
      fontFamily: "monospace", fontSize: "14px", color: "#4fc3f7", wordWrap: { width: 640 },
    });
    const copy = makeButton(this, 200, 224, "Copy link", { width: 200, height: 32, color: 0x2e7d32 });
    copy.onClick(() => this.copyLink(copy));
    this.nameBtn = makeButton(this, 470, 224, "Set custom name", { width: 240, height: 32, color: 0x1565c0 });
    this.nameBtn.onClick(() => this.setAlias());

    // --- earnings panel ---
    drawPanel(this, 60, 272, 680, 180);
    this.add.text(80, 288, "YOUR EARNINGS", {
      fontFamily: "monospace", fontSize: "12px", color: "#78909c", fontStyle: "bold",
    });
    this.earnedText = this.stat(150, 340, "ETH earned", "#ffca28");
    this.invitesText = this.stat(400, 340, "Invites", "#eceff1");
    this.pendingText = this.stat(630, 340, "Pending", "#81c784");

    this.claimBtn = makeButton(this, 400, 424, "Claim pending ETH", { width: 260, height: 34, color: 0x2e7d32 });
    this.claimBtn.onClick(() => this.claim());
    this.claimBtn.container.setVisible(false);

    this.status = this.add.text(400, 486, "", {
      fontFamily: "monospace", fontSize: "13px", color: "#90a4ae", wordWrap: { width: 700 },
    }).setOrigin(0.5);

    this.refresh();
  }

  /** A centered label + big value column, returns the value text handle. */
  private stat(cx: number, cy: number, label: string, color: string): Phaser.GameObjects.Text {
    this.add.text(cx, cy - 20, label, {
      fontFamily: "monospace", fontSize: "12px", color: "#90a4ae",
    }).setOrigin(0.5);
    return this.add.text(cx, cy + 6, "—", {
      fontFamily: "monospace", fontSize: "22px", color, fontStyle: "bold",
    }).setOrigin(0.5);
  }

  private setStatus(msg: string, color = "#90a4ae") {
    this.status.setColor(color).setText(msg);
  }

  private async copyLink(btn: Button) {
    if (!this.link) return;
    try {
      await navigator.clipboard.writeText(this.link);
      btn.setLabel("Copied!");
      this.time.delayedCall(1200, () => btn.setLabel("Copy link"));
    } catch {
      this.setStatus("Clipboard unavailable — link shown above.");
    }
  }

  private async refresh() {
    const addr = connectedAddress();
    if (!addr) {
      this.setStatus("Wallet not connected.", "#ef9a9a");
      return;
    }
    // load the wallet's current alias so the link can use it
    try {
      const r = await fetch(`${SERVER_URL}/referrals/alias/${addr}`);
      this.alias = (await r.json()).alias ?? null;
    } catch {
      this.alias = null;
    }
    if (!this.sys.settings.active) return;
    const handle = this.alias ?? addr;
    this.link = `${location.origin}/?ref=${handle}`;
    this.linkText.setText(this.link);

    if (!GACHA_ENABLED) {
      this.setStatus("Referral rewards go live with the $BLAST launch — your link already works.");
      return;
    }
    try {
      const s = await referralStats();
      if (!this.sys.settings.active) return;
      this.earnedText.setText(Number(formatEther(s.earnedWei)).toFixed(4));
      this.invitesText.setText(String(s.invites));
      this.pendingText.setText(Number(formatEther(s.pendingWei)).toFixed(4));
      this.pctText.setText(`You earn ${(s.bps / 100).toFixed(0)}% of every chest your invites buy.`);
      this.claimBtn.container.setVisible(s.pendingWei > 0n);
      this.setStatus("");
    } catch (e) {
      if (!this.sys.settings.active) return;
      this.setStatus(`Could not load your stats: ${shortErr(e)}`, "#ef9a9a");
    }
  }

  private async setAlias() {
    const addr = connectedAddress();
    if (!addr) return;
    const raw = window.prompt("Choose a custom referral name (3-20 letters, digits, - or _):", this.alias ?? "");
    if (raw === null) return; // cancelled
    const alias = raw.trim();
    if (!ALIAS_RE.test(alias)) {
      this.setStatus("Name must be 3-20 letters, digits, - or _", "#ef9a9a");
      return;
    }
    try {
      this.nameBtn.setEnabled(false);
      this.setStatus("Sign the name claim in your wallet...");
      const signature = await signMessage(aliasClaimMessage(alias, addr));
      const res = await fetch(`${SERVER_URL}/referrals/alias`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr, alias, signature }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      if (!this.sys.settings.active) return;
      this.setStatus(`Your custom link is ready! Share /?ref=${alias}`, "#81c784");
      await this.refresh();
    } catch (e) {
      if (!this.sys.settings.active) return;
      this.setStatus(`Could not set name: ${shortErr(e)}`, "#ef9a9a");
    } finally {
      this.nameBtn.setEnabled(true);
    }
  }

  private async claim() {
    try {
      this.claimBtn.setEnabled(false);
      this.setStatus("Confirm the claim in your wallet...");
      await claimReferral();
      if (!this.sys.settings.active) return;
      this.setStatus("Claimed! ETH sent to your wallet.", "#81c784");
      await this.refresh();
    } catch (e) {
      if (!this.sys.settings.active) return;
      this.setStatus(`Claim failed: ${shortErr(e)}`, "#ef9a9a");
    } finally {
      this.claimBtn.setEnabled(true);
    }
  }
}
