import os
from fpdf import FPDF
from fpdf.enums import XPos, YPos

class RecSystemDoc(FPDF):
    def __init__(self):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.set_auto_page_break(auto=True, margin=15)
        self.set_margins(15, 15, 15)

    def header(self):
        if self.page_no() == 1:
            return
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(181, 70, 16) # Burnt orange
        self.cell(100, 6, "PROOFPASS | RECOMMENDATION SYSTEM API BLUEPRINT", border=0, align="L")
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(120, 120, 120)
        self.cell(80, 6, "Hackathon Team Reference", border=0, align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_draw_color(220, 220, 220)
        self.set_line_width(0.3)
        self.line(15, self.get_y(), 195, self.get_y())
        self.ln(3)

    def footer(self):
        self.set_y(-12)
        self.set_draw_color(220, 220, 220)
        self.set_line_width(0.3)
        self.line(15, self.get_y(), 195, self.get_y())
        self.set_font("Helvetica", "", 8)
        self.set_text_color(130, 130, 130)
        self.cell(100, 6, "ProofPass Engineering Team - Recommendation Stack", border=0, align="L")
        self.cell(80, 6, f"Page {self.page_no()}", border=0, align="R")

    def category_title(self, num, title):
        if self.get_y() > 245:
            self.add_page()
        self.ln(2.5)
        self.set_font("Helvetica", "B", 12)
        self.set_fill_color(248, 246, 242) # Warm ivory tint
        self.set_text_color(181, 70, 16) # Burnt orange
        self.cell(180, 8, f"  {num}. {title}", border=0, fill=True, align="L", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(2)

    def api_card(self, api_name, cost, target_feature, how_it_helps, how_to_implement):
        # Calculate height dynamically
        if self.get_y() > 230:
            self.add_page()

        start_y = self.get_y()
        self.set_fill_color(252, 251, 249)
        self.set_draw_color(218, 215, 210)
        self.set_line_width(0.25)
        
        # Estimate height based on content
        self.rect(15, start_y, 180, 31, style="FD")
        
        # Header strip inside card
        self.set_xy(18, start_y + 2)
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(26, 25, 24)
        self.cell(90, 5, api_name)
        
        # Cost badge
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(181, 70, 16)
        self.cell(72, 5, f"[{cost}]", align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        # Feature line
        self.set_xy(18, start_y + 7.5)
        self.set_font("Helvetica", "B", 8.5)
        self.set_text_color(120, 70, 30)
        self.write(4, "Feature Target: ")
        self.set_font("Helvetica", "", 8.5)
        self.set_text_color(40, 40, 40)
        self.write(4, target_feature + "\n")

        # How it helps
        self.set_x(18)
        self.set_font("Helvetica", "B", 8.5)
        self.set_text_color(26, 25, 24)
        self.write(4, "How it Helps: ")
        self.set_font("Helvetica", "", 8.5)
        self.set_text_color(50, 50, 50)
        self.write(4, how_it_helps + "\n")

        # How to implement
        self.set_x(18)
        self.set_font("Helvetica", "B", 8.5)
        self.set_text_color(26, 25, 24)
        self.write(4, "Implementation: ")
        self.set_font("Helvetica", "I", 8.2)
        self.set_text_color(70, 70, 70)
        self.write(4, how_to_implement)

        self.set_y(start_y + 33.5)

def build_pdf():
    pdf = RecSystemDoc()
    pdf.add_page()

    # COVER BANNER
    pdf.set_fill_color(26, 25, 24) # Soft black
    pdf.rect(15, 15, 180, 32, style="F")

    # Accent bar on left
    pdf.set_fill_color(181, 70, 16) # Burnt orange
    pdf.rect(15, 15, 5, 32, style="F")

    pdf.set_xy(25, 19)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(165, 7, "RECOMMENDATION SYSTEM: API CHEAT SHEET", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_xy(25, 27)
    pdf.set_font("Helvetica", "", 9.5)
    pdf.set_text_color(232, 128, 63)
    pdf.cell(165, 5, "Tools, Free APIs & Datasets to Implement Every Recommendation Feature", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_xy(25, 34)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(180, 180, 180)
    pdf.cell(165, 4, "Internal Team Reference Guide | ProofPass Hackathon Project", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_y(51)

    # Intro note
    pdf.set_font("Helvetica", "", 8.8)
    pdf.set_text_color(50, 50, 50)
    pdf.multi_cell(180, 4.5, 
        "Note for Team Members: We do NOT need to collect massive datasets or train our own machine learning models from scratch. "
        "Each recommendation feature below uses lightweight free APIs, open datasets, and mathematical formulas that can be built in hours."
    )
    pdf.ln(1)

    # 1. Course & Practice
    pdf.category_title("1", "Course & Practice Recommendations (/recommendations)")
    
    pdf.api_card(
        api_name="YouTube Data API v3",
        cost="100% Free (10,000 units/day)",
        target_feature="Course & Video Tutorial Recommendations",
        how_it_helps="Automatically searches top-rated, modern video courses for any missing skill and returns video thumbnails and channel names.",
        how_to_implement="Send GET request: https://www.googleapis.com/youtube/v3/search?q={skill}+tutorial+project&type=video"
    )

    pdf.api_card(
        api_name="GitHub Public Search API",
        cost="100% Free (5,000 requests/hr)",
        target_feature="Real-Work Practice & Open-Source Tasks",
        how_it_helps="Fetches live beginner-friendly bugs from active GitHub repos so students write real code to verify their skills.",
        how_to_implement="Send GET request: https://api.github.com/search/issues?q=label:good-first-issue+language:{skill}"
    )

    pdf.api_card(
        api_name="Kaggle Free Tech Courses Dataset",
        cost="100% Free (Offline 3MB CSV)",
        target_feature="Coursera & Udemy Course Recommendations",
        how_it_helps="Provides an instant offline database of 30,000+ real tech courses with ratings and URLs. Guarantees 0-cost and 0-latency.",
        how_to_implement="Load CSV into SQLite (proofpass.db). Query: SELECT title, url FROM courses WHERE skill LIKE '%{skill}%' LIMIT 3;"
    )

    # 2. Roadmaps
    pdf.category_title("2", "Skill-Gap Roadmaps (/learnings)")

    pdf.api_card(
        api_name="Roadmap.sh Open-Source Repository",
        cost="100% Free & Open Source",
        target_feature="Standard Step-by-Step Career Roadmaps",
        how_it_helps="The 280,000-star project provides structured JSON and markdown roadmaps for every tech role (Frontend, Backend, DevOps, etc.).",
        how_to_implement="Fetch or copy raw JSON files directly from GitHub: github.com/kamranahmedse/developer-roadmap"
    )

    pdf.api_card(
        api_name="Google Gemini 1.5 Flash API",
        cost="100% Free Tier (15 requests/min)",
        target_feature="Dynamic Custom Milestones & Study Tasks",
        how_it_helps="Generates a customized 4-step checklist to upgrade a specific skill from Claimed to Verified in 400 milliseconds.",
        how_to_implement="Prompt Gemini with response_format={'type': 'json_object'}: 'Create 4 steps to verify [skill] with practical tasks.'"
    )

    # 3. Role Matching
    pdf.category_title("3", "Best-Matching Job Roles (Applicant Dashboard)")

    pdf.api_card(
        api_name="Weighted Math Matching Engine",
        cost="Free (Pure Code, No External API)",
        target_feature="Deterministic Job Match Percentage",
        how_it_helps="Calculates transparent percentage scores (0 to 100%) based on job requirements (Must/Should/Nice) vs candidate states (V/S/C/X).",
        how_to_implement="10 lines of Python or JS math: Sum(Skill_Score * Importance_Weight) / Max_Possible_Weight * 100. Runs in 0.001 ms."
    )

    pdf.api_card(
        api_name="Sentence-Transformers / Gemini Embeddings",
        cost="100% Free",
        target_feature="Semantic Skill Matching (Synonym Handling)",
        how_it_helps="Matches skills even if words differ (e.g. recognizes that 'FastAPI' matches 'Python REST APIs' with 94% semantic similarity).",
        how_to_implement="Use Python sentence-transformers ('all-MiniLM-L6-v2') or free Gemini embeddings to calculate cosine similarity."
    )

    # 4. Nearest Companies & Internships
    pdf.category_title("4", "Nearest Companies & Internships (Offline / Online)")

    pdf.api_card(
        api_name="HTML5 Geolocation + Haversine Math",
        cost="Free (Native Browser + 5 Lines Math)",
        target_feature="Automatic Distance Calculation (KM)",
        how_it_helps="Browser detects the candidate's latitude/longitude; a 5-line math formula calculates exact distance to local company offices.",
        how_to_implement="navigator.geolocation.getCurrentPosition() -> compute distance to company lat/long using standard Haversine formula."
    )

    pdf.api_card(
        api_name="JSearch API (RapidAPI)",
        cost="Free Tier (500 requests/month)",
        target_feature="Live Job & Internship Postings",
        how_it_helps="Scrapes live job openings directly from LinkedIn, Indeed, and Glassdoor with exact office addresses, logos, and salaries.",
        how_to_implement="Call RapidAPI: GET /search?query='React Intern in Pune'&num_pages=1 -> parses live jobs and office coordinates."
    )

    pdf.api_card(
        api_name="Mapbox GL API",
        cost="Free Tier (50,000 map loads/month)",
        target_feature="Interactive Dark-Mode Radar Map UI",
        how_it_helps="Renders glowing burnt-orange pins for high-matching nearby companies on an Apple-Maps quality dark theme.",
        how_to_implement="React component using react-map-gl or mapbox-gl. Display pins for jobs with >80% match within 15 km."
    )

    output_path = os.path.abspath("recommendation_system.pdf")
    pdf.output(output_path)
    print(f"PDF successfully generated at: {output_path}")

if __name__ == "__main__":
    build_pdf()

