import os
import sys
from fpdf import FPDF
from fpdf.enums import XPos, YPos

class ProofPassDoc(FPDF):
    def __init__(self):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.set_auto_page_break(auto=True, margin=18)
        self.set_margins(15, 15, 15)

    def header(self):
        if self.page_no() == 1:
            return  # Suppress header on cover/title page
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(181, 70, 16)  # Burnt orange
        self.cell(100, 6, "PROOFPASS | TECHNICAL FEATURE BLUEPRINT", border=0, align="L")
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(120, 120, 120)
        self.cell(80, 6, "Hackathon IM-03 (Skill Passport)", border=0, align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_draw_color(220, 220, 220)
        self.set_line_width(0.3)
        self.line(15, self.get_y(), 195, self.get_y())
        self.ln(3)

    def footer(self):
        self.set_y(-14)
        self.set_draw_color(220, 220, 220)
        self.set_line_width(0.3)
        self.line(15, self.get_y(), 195, self.get_y())
        self.set_font("Helvetica", "", 8)
        self.set_text_color(130, 130, 130)
        self.cell(100, 6, "ProofPass Engineering Team - Internal Implementation Guide", border=0, align="L")
        self.cell(80, 6, f"Page {self.page_no()}", border=0, align="R")

    def chapter_title(self, num, title):
        if self.get_y() > 245:
            self.add_page()
        self.ln(3)
        self.set_font("Helvetica", "B", 13)
        self.set_fill_color(248, 246, 242)  # Warm ivory
        self.set_text_color(181, 70, 16)   # Burnt orange
        self.cell(180, 9, f"  {num}. {title}", border=0, fill=True, align="L", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(2)

    def section_title(self, title):
        if self.get_y() > 255:
            self.add_page()
        self.ln(2)
        self.set_font("Helvetica", "B", 10.5)
        self.set_text_color(26, 25, 24)  # Soft black
        self.cell(180, 6, title, border=0, align="L", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(1)

    def body_p(self, text):
        self.set_font("Helvetica", "", 9.5)
        self.set_text_color(45, 45, 45)
        self.multi_cell(180, 5, text)
        self.ln(1.5)

    def bullet(self, label, text):
        if self.get_y() > 260:
            self.add_page()
        self.set_x(15)
        self.set_font("Helvetica", "B", 9.5)
        self.set_text_color(181, 70, 16)
        self.write(5, "> " + label + ": ")
        self.set_font("Helvetica", "", 9.5)
        self.set_text_color(45, 45, 45)
        self.write(5, text)
        self.ln(6.5)

    def callout_box(self, title, text, box_type="info"):
        lines = text.strip().split("\n")
        est_h = len(lines) * 4.6 + 13
        if self.get_y() + est_h > 270:
            self.add_page()

        self.ln(2)
        if box_type == "alert":
            bg_r, bg_g, bg_b = 254, 242, 242
            border_r, border_g, border_b = 239, 68, 68
            title_r, title_g, title_b = 185, 28, 28
        elif box_type == "success":
            bg_r, bg_g, bg_b = 240, 253, 244
            border_r, border_g, border_b = 34, 197, 94
            title_r, title_g, title_b = 21, 128, 61
        else:
            bg_r, bg_g, bg_b = 254, 247, 242
            border_r, border_g, border_b = 232, 128, 63
            title_r, title_g, title_b = 181, 70, 16

        start_y = self.get_y()
        self.set_fill_color(bg_r, bg_g, bg_b)
        self.set_draw_color(border_r, border_g, border_b)
        self.set_line_width(0.35)

        self.rect(15, start_y, 180, est_h, style="FD")
        self.set_xy(18, start_y + 2.5)
        self.set_font("Helvetica", "B", 9.5)
        self.set_text_color(title_r, title_g, title_b)
        self.cell(174, 5, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        self.set_xy(18, start_y + 8)
        self.set_font("Helvetica", "", 8.8)
        self.set_text_color(50, 50, 50)
        for line in lines:
            self.cell(174, 4.4, line, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            self.set_x(18)
        self.set_y(start_y + est_h + 3)

    def code_block(self, code_text):
        lines = code_text.strip().split("\n")
        block_h = len(lines) * 4.2 + 5
        if self.get_y() + block_h > 270:
            self.add_page()

        self.ln(1)
        self.set_fill_color(240, 238, 235)
        self.set_draw_color(210, 208, 205)
        self.set_line_width(0.2)

        start_y = self.get_y()
        self.rect(15, start_y, 180, block_h, style="FD")
        self.set_xy(18, start_y + 2.5)
        self.set_font("Courier", "", 8.2)
        self.set_text_color(25, 25, 25)
        for line in lines:
            self.cell(174, 4.2, line, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            self.set_x(18)
        self.set_y(start_y + block_h + 2.5)

    def task_card(self, code, title, role, desc):
        if self.get_y() > 250:
            self.add_page()
        self.ln(1.5)
        self.set_fill_color(248, 248, 248)
        self.set_draw_color(215, 215, 215)
        self.set_line_width(0.25)
        start_y = self.get_y()
        self.rect(15, start_y, 180, 18, style="FD")

        # Code badge
        self.set_fill_color(181, 70, 16) if role == "Frontend" else self.set_fill_color(40, 40, 40)
        self.rect(18, start_y + 3, 14, 6, style="F")
        self.set_xy(18, start_y + 3)
        self.set_font("Helvetica", "B", 7.5)
        self.set_text_color(255, 255, 255)
        self.cell(14, 6, code, align="C")

        # Title & Role
        self.set_xy(35, start_y + 2.5)
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(26, 25, 24)
        self.cell(100, 5, title)

        self.set_font("Helvetica", "I", 8)
        self.set_text_color(130, 130, 130)
        self.cell(55, 5, f"[{role}]", align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        # Description
        self.set_xy(18, start_y + 9.5)
        self.set_font("Helvetica", "", 8.5)
        self.set_text_color(60, 60, 60)
        self.cell(174, 5, desc, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_y(start_y + 20)

def build_pdf():
    pdf = ProofPassDoc()
    pdf.add_page()

    # COVER / HEADER BANNER
    pdf.set_fill_color(26, 25, 24)  # Soft black
    pdf.rect(15, 15, 180, 40, style="F")

    # Accent bar on left
    pdf.set_fill_color(181, 70, 16)  # Burnt orange
    pdf.rect(15, 15, 5, 40, style="F")

    pdf.set_xy(25, 19)
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(165, 8, "PROOFPASS | NEW FEATURES BLUEPRINT", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_xy(25, 28)
    pdf.set_font("Helvetica", "", 10.5)
    pdf.set_text_color(232, 128, 63)
    pdf.cell(165, 5, "Live Stage Tamper Demo & Dynamic GitHub README Badge", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_xy(25, 35)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(180, 180, 180)
    pdf.cell(165, 5, "Target: Hackathon IM-03 (Skill Passport: Verified Skills from Real Work)", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_y(58)

    # 1. Executive Summary
    pdf.chapter_title("1", "Executive Summary: Why These Two Features?")
    pdf.body_p(
        "ProofPass solves a huge real-world problem: technical resume fraud and unearned GitHub repositories. "
        "However, to win top honors at Hackathon IM-03, technical execution must be paired with undeniable proof "
        "and real-world portability. We are adding two high-impact features for the final submission:"
    )
    pdf.bullet("1. Live Tamper Demonstration on Stage", 
               "Judges often doubt whether 'cryptographic seals' are real or just a static CSS badge. By intentionally "
               "tampering with a skill on stage and showing the system reject it in real-time with an alarm, we prove the "
               "authenticity of our SHA-256 state engine beyond question.")
    pdf.bullet("2. Dynamic GitHub README Badge & Public Link", 
               "A skill passport must not remain locked inside our localhost website. By offering dynamic SVG badges for "
               "GitHub profiles and public verification links, candidates can showcase verified proof to any recruiter worldwide.")

    pdf.callout_box("The Hackathon Winning Formula", 
                    "Judges judge on: Impact (Does it solve resume fraud?), Tech Rigor (Is it cryptographic or just mock?), "
                    "and Demo Quality (Does the live demo have a 'WOW' moment?). These two features hit all three criteria.", "info")

    # 2. FEATURE 1: LIVE TAMPER DEMONSTRATION
    pdf.chapter_title("2", "Feature 1: Live Tamper Demonstration on Stage")
    
    pdf.section_title("2.1 Simple Layman Explanation (For Team Members)")
    pdf.body_p(
        "Think of a physical passport with an embedded holographic watermark. If someone uses white-out to change their "
        "name or stamps a fake visa, border control's ultraviolet scanner immediately lights up RED."
    )
    pdf.body_p(
        "In ProofPass, every passport is mathematically sealed with a SHA-256 cryptographic hash calculated over all "
        "verified skills, commit evidence, and state ratings. On stage, we provide a 'Tamper Simulator' button. When clicked, "
        "we artificially change a candidate's skill (e.g., Docker from 'Claimed' to 'Verified'). The engine recalculates "
        "the hash, detects the mismatch, flashes a crimson alert, and revokes the seal in real time."
    )

    pdf.section_title("2.2 Tech Stack Required")
    pdf.bullet("Frontend Crypto", "Native Web Crypto API (window.crypto.subtle.digest) - Built into modern browsers, 0 dependencies.")
    pdf.bullet("Backend Crypto", "Python hashlib (hashlib.sha256) inside FastAPI for server-side integrity checking.")
    pdf.bullet("UI & Animations", "Lucide React icons (ShieldCheck, ShieldAlert), CSS keyframe pulse/shake animations.")

    pdf.section_title("2.3 Mathematical Logic & How It Works")
    pdf.body_p(
        "The cryptographic seal is calculated over a deterministic, sorted array of all passport claims. In SHA-256, changing "
        "even a single letter completely alters the 64-character hexadecimal hash (the Avalanche Effect):"
    )
    pdf.code_block(
        "// 1. Data stringification (Canonical Order)\n"
        "Payload = [applicant_id, issued_at, sorted_skills_with_evidence_hashes]\n"
        "SealHash = SHA256(JSON.stringify(Payload))\n"
        "\n"
        "// 2. Integrity Verification (Run on every view / load)\n"
        "CurrentHash = SHA256(JSON.stringify(Current_Passport_Data))\n"
        "IsValid = (CurrentHash === Stored_SealHash) // False if anything changed!"
    )

    pdf.section_title("2.4 Implementation in Existing Codebase")
    pdf.bullet("File to Modify", "frontend/src/pages/PassportView.jsx (and engine/stateEngine.js)")
    pdf.bullet("Step 1 (State)", "Add const [isTampered, setIsTampered] = useState(false); in PassportView.jsx.")
    pdf.bullet("Step 2 (Demo Switch)", "Add a 'Simulate Tamper' toggle switch visible in demo mode.")
    pdf.bullet("Step 3 (Tamper Handler)", "When clicked, alter one skill state (e.g. 'Docker' state = 'V') in local state.")
    pdf.bullet("Step 4 (Integrity Engine)", "Recompute hash using crypto.subtle. Compare with stored sealHash.")
    pdf.bullet("Step 5 (Visual Alert)", "If mismatch: switch seal badge to Red, show 'TAMPER DETECTED', display mismatch diff.")

    pdf.code_block(
        "// Frontend implementation snippet (PassportView.jsx)\n"
        "async function checkIntegrity(passport) {\n"
        "  const payload = JSON.stringify(passport.skills.map(s => [s.name, s.state, s.evidenceHash]));\n"
        "  const msgBuffer = new TextEncoder().encode(payload);\n"
        "  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);\n"
        "  const currentHash = Array.from(new Uint8Array(hashBuffer))\n"
        "    .map(b => b.toString(16).padStart(2, '0')).join('');\n"
        "  return currentHash === passport.sealHash;\n"
        "}"
    )

    pdf.callout_box("The 30-Second Stage Demo Script", 
                    "Speaker: 'Judges often ask: What prevents a student from editing their passport scores in Chrome Inspect Element?'\n"
                    "Action: Toggle 'Simulate Tamper' on screen (Docker changes from Claimed to Verified).\n"
                    "Result: Entire UI flashes crimson. Warning: 'CRITICAL ALERT: CRYPTOGRAPHIC HASH MISMATCH. Passport Revoked.'\n"
                    "Speaker: 'Every passport is sealed with SHA-256. If a single commit hash is altered, the seal shatters.'", "alert")

    # 3. FEATURE 2: DYNAMIC GITHUB README BADGE
    pdf.chapter_title("3", "Feature 2: Shareable Public Link & Dynamic GitHub Badge")

    pdf.section_title("3.1 Simple Layman Explanation")
    pdf.body_p(
        "GitHub profile READMEs do not allow JavaScript or interactive widgets; they only permit image tags. "
        "This feature creates a special API endpoint that generates a live SVG image on the fly. When an applicant pastes "
        "this badge into their GitHub README, visitors see their verified skills in real time. Clicking the badge opens "
        "their official ProofPass verification page."
    )

    pdf.section_title("3.2 Tech Stack Required")
    pdf.bullet("Backend", "FastAPI (Python 3.10+) route returning Response(content=svg, media_type='image/svg+xml').")
    pdf.bullet("Database", "SQLite (proofpass.db) query to retrieve passport skills count and match percentage.")
    pdf.bullet("Frontend Modal", "ShareModal.jsx with tabs for GitHub Markdown, HTML Embed, and Direct URL.")

    pdf.section_title("3.3 How the GitHub Dynamic Badge Works")
    pdf.body_p(
        "1. Candidate pastes this markdown in their GitHub profile README:\n"
        "   [![ProofPass Verified](http://localhost:8000/api/v1/badges/passport_123.svg)](http://localhost:5173/passport/passport_123)\n"
        "2. GitHub requests the SVG image from FastAPI endpoint GET /api/v1/badges/{id}.svg.\n"
        "3. FastAPI queries SQLite for passport_123, counts Verified skills (e.g., 4 Verified | 92% Match).\n"
        "4. FastAPI returns an SVG graphic colored in ProofPass burnt orange (#b54610) with HTTP Cache-Control: no-cache."
    )

    pdf.section_title("3.4 Backend Code Implementation (FastAPI)")
    pdf.code_block(
        "# backend/api/badges.py (or inside main.py)\n"
        "from fastapi import APIRouter, Response\n"
        "\n"
        "@app.get('/api/v1/badges/{passport_id}.svg')\n"
        "def get_badge(passport_id: str):\n"
        "    passport = get_passport_from_db(passport_id) # Query SQLite\n"
        "    v_count = sum(1 for s in passport['skills'] if s['state'] == 'V')\n"
        "\n"
        "    svg = f'''<svg xmlns='http://www.w3.org/2000/svg' width='220' height='28'>\n"
        "      <rect rx='4' width='100%' height='100%' fill='#1a1918'/>\n"
        "      <rect rx='4' x='110' width='110' height='100%' fill='#b54610'/>\n"
        "      <text x='10' y='18' fill='#fff' font-family='sans-serif' font-size='11' font-weight='bold'>ProofPass</text>\n"
        "      <text x='118' y='18' fill='#fff' font-family='sans-serif' font-size='11'>{v_count} Verified Skills</text>\n"
        "    </svg>'''\n"
        "    return Response(content=svg, media_type='image/svg+xml',\n"
        "                    headers={'Cache-Control': 'no-cache, no-store, must-revalidate'})"
    )

    pdf.section_title("3.5 Frontend Code Implementation (Share Modal)")
    pdf.code_block(
        "// Frontend snippet for ShareModal.jsx\n"
        "const markdownBadge = `[![ProofPass](${API_BASE}/api/v1/badges/${id}.svg)](${WEB_BASE}/passport/${id})`;\n"
        "\n"
        "return (\n"
        "  <div className='share-modal'>\n"
        "    <h3>Share Your Verified Skill Passport</h3>\n"
        "    <label>GitHub Profile README Markdown</label>\n"
        "    <input readOnly value={markdownBadge} />\n"
        "    <button onClick={() => navigator.clipboard.writeText(markdownBadge)}>Copy Markdown</button>\n"
        "  </div>\n"
        ");"
    )

    pdf.callout_box("The 20-Second Badge Stage Demo Script",
                    "Speaker: 'A skill passport shouldn't stay trapped on our website. With one click, an applicant generates a live "
                    "dynamic GitHub badge. As soon as you verify a new skill, the badge automatically updates on GitHub!'\n"
                    "Action: Show real GitHub profile with glowing burnt-orange badge. Click it -> Opens live ProofPass verification.", "success")

    # 4. TASK DIVISION MATRIX
    pdf.add_page()
    pdf.chapter_title("4", "Team Responsibility Matrix (Division of Work)")
    pdf.body_p(
        "To build these features quickly before the hackathon demo, divide the tasks clearly between Frontend and Backend:"
    )

    pdf.task_card("FE-1", "Tamper Simulation UI & State", "Frontend", 
                  "Add toggle switch and isTampered state in PassportView.jsx. Alter skill and trigger check.")
    pdf.task_card("FE-2", "Web Crypto Integrity Function", "Frontend", 
                  "Write checkIntegrity() using native crypto.subtle. Compare calculated hash with stored sealHash.")
    pdf.task_card("FE-3", "Share & Embed Modal", "Frontend", 
                  "Create ShareModal.jsx with copyable tabs for GitHub Markdown, HTML Embed, and Direct Link.")
    pdf.task_card("BE-1", "FastAPI Dynamic Badge Route", "Backend", 
                  "Add GET /api/v1/badges/{passport_id}.svg endpoint returning SVG with no-cache headers.")
    pdf.task_card("BE-2", "Backend Verification Route", "Backend", 
                  "Implement GET /api/v1/passports/{id}/verify returning JSON { valid: bool, originalHash, currentHash }.")
    pdf.task_card("BE-3", "Database Seed Personas", "Backend", 
                  "Ensure SQLite seed data has 2 demo accounts: 'Alex' (4 Verified) and 'Chad' (Flagged / Contradicted).")

    # 5. JUDGE Q&A CHEAT SHEET
    pdf.chapter_title("5", "Hackathon Pitch Cheat Sheet (Judge Q&A)")

    pdf.bullet("Q1: Why not store passports on a blockchain?",
               "Answer: Blockchains introduce gas fees, latency, and unnecessary wallet friction for college students. "
               "SHA-256 cryptographic hashes give mathematical unforgeability instantly with zero cost and 5ms latency.")

    pdf.bullet("Q2: Can candidates buy fake GitHub stars or commits to trick your engine?",
               "Answer: Stars are ignored. ProofPass evaluates git blame line authorship percentage, commit intervals, and "
               "file hashes. Cloned or forked tutorial repositories hit a strict trust ceiling of 0 (Contradicted).")

    pdf.bullet("Q3: What if someone shares an expired or revoked passport link?",
               "Answer: The public URL checks database validity on every render. If revoked, the page shows an explicit red "
               "warning banner stating when and why the passport was revoked.")

    output_path = os.path.abspath("ProofPass_New_Features_Blueprint.pdf")
    pdf.output(output_path)
    print(f"PDF successfully generated at: {output_path}")

if __name__ == "__main__":
    build_pdf()
