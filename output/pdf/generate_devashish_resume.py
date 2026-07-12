from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


OUTPUT = "output/pdf/devashish_singh_resume.pdf"


WIDTH, HEIGHT = letter
LEFT = 48
RIGHT = 48
TOP = 42
BOTTOM = 38
BODY = "Helvetica"
BOLD = "Helvetica-Bold"
ITALIC = "Helvetica-Oblique"
TEXT = colors.black
MUTED = colors.HexColor("#333333")


def draw_center(c, text, y, font, size):
    c.setFont(font, size)
    c.setFillColor(TEXT)
    c.drawCentredString(WIDTH / 2, y, text)


def draw_rule(c, y):
    c.setStrokeColor(colors.black)
    c.setLineWidth(0.6)
    c.line(LEFT, y, WIDTH - RIGHT, y)


def section(c, title, y):
    c.setFont(BOLD, 10.5)
    c.setFillColor(TEXT)
    c.drawString(LEFT, y, title.upper())
    draw_rule(c, y - 2.5)
    return y - 13


def fit_text(c, text, max_width, font=BODY, size=9.2):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if stringWidth(candidate, font, size) <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def bullet(c, text, y):
    c.setFont(BODY, 9.0)
    c.setFillColor(TEXT)
    max_width = WIDTH - LEFT - RIGHT - 17
    lines = fit_text(c, text, max_width, BODY, 9.0)
    c.drawString(LEFT + 7, y, "-")
    c.drawString(LEFT + 17, y, lines[0])
    for line in lines[1:]:
        y -= 10.0
        c.drawString(LEFT + 17, y, line)
    return y - 10.2


def project(c, title, tech, bullets, y):
    c.setFont(BOLD, 9.7)
    c.setFillColor(TEXT)
    c.drawString(LEFT, y, title)
    title_w = stringWidth(title, BOLD, 9.7)
    c.setFont(ITALIC, 9.3)
    c.setFillColor(MUTED)
    c.drawString(LEFT + title_w + 4, y, f"| {tech}")
    y -= 11
    for item in bullets:
        y = bullet(c, item, y)
    return y - 1


def project_with_link(c, title, tech, link, bullets, y):
    c.setFont(BOLD, 9.7)
    c.setFillColor(TEXT)
    c.drawString(LEFT, y, title)
    title_w = stringWidth(title, BOLD, 9.7)
    c.setFont(ITALIC, 9.3)
    c.setFillColor(MUTED)
    c.drawString(LEFT + title_w + 4, y, f"| {tech}")
    c.setFont(BODY, 8.7)
    c.drawRightString(WIDTH - RIGHT, y, link)
    y -= 11
    for item in bullets:
        y = bullet(c, item, y)
    return y - 1


def skill_line(c, label, value, y):
    c.setFont(BOLD, 9.0)
    c.setFillColor(TEXT)
    c.drawString(LEFT, y, label)
    label_w = stringWidth(label, BOLD, 9.0)
    c.setFont(BODY, 9.0)
    c.drawString(LEFT + label_w + 3, y, value)
    return y - 11


def build():
    c = canvas.Canvas(OUTPUT, pagesize=letter)
    c.setTitle("Devashish Singh Resume")

    y = HEIGHT - TOP
    draw_center(c, "Devashish Singh", y, BOLD, 19)
    y -= 15
    draw_center(c, "fordevsingh@gmail.com | github.com/fordevsingh", y, BODY, 9.5)
    y -= 19

    y = section(c, "Education", y)
    c.setFont(BOLD, 9.4)
    c.setFillColor(TEXT)
    c.drawString(LEFT, y, "Add your degree, college/university, location")
    c.setFont(BODY, 9.2)
    c.drawRightString(WIDTH - RIGHT, y, "Add graduation dates")
    y -= 16

    y -= 3
    y = section(c, "Projects", y)
    y = project_with_link(
        c,
        "HoopDB",
        "Java 17, Javalin, Oracle Database, JDBC, Maven, Gson, HTML/CSS/JavaScript",
        "github.com/fordevsingh/hoopdb",
        [
            "Built a basketball league management web app with a Javalin REST API, Oracle relational schema, DAO layer, and browser UI.",
            "Modeled players, teams, coaches, venues, seasons, matches, and performance records with SQL scripts for sample data, procedures, sequences, and triggers.",
            "Implemented CRUD and reporting workflows for player search, team and coach management, box scores, career averages, all-time team wins, and season standings.",
        ],
        y,
    )
    y = project_with_link(
        c,
        "Hotel Management System",
        "Java 17, JavaFX 21, Maven, FXML, CSS",
        "github.com/fordevsingh/hotel-management-system",
        [
            "Developed a JavaFX desktop application for hotel rooms, customers, bookings, checkout, and billing from a styled dashboard.",
            "Designed layered Java modules with models, service logic, repository persistence, backup snapshots, validation helpers, and controller-driven UI events.",
            "Added room availability tracking, booking validation, checkout bill generation, dashboard summaries, serialized backup recovery, logging, and a live clock thread.",
        ],
        y,
    )
    y = project_with_link(
        c,
        "OpenBook",
        "JavaScript, PDF.js, Vite, IndexedDB, HTML/CSS",
        "github.com/fordevsingh/OpenBook",
        [
            "Built a local-first PDF reader that opens user-selected PDFs in the browser using PDF.js rendering and a Vite frontend setup.",
            "Implemented IndexedDB storage for recent files, document metadata, reading progress, zoom level, and page bookmarks with automatic eviction of older files.",
            "Created a reader interface with collapsible navigation, recent files, document outline, bookmark panels, page controls, zoom actions, sample loading, and dark mode.",
        ],
        y,
    )

    y -= 3
    y = section(c, "Technical Skills", y)
    y = skill_line(c, "Languages:", "Java, JavaScript, SQL, HTML/CSS", y)
    y = skill_line(c, "Frameworks/Libraries:", "Javalin, JavaFX, PDF.js, Vite, Gson, FXML", y)
    y = skill_line(c, "Databases/Storage:", "Oracle Database, JDBC, IndexedDB, file-based persistence, serialized backups", y)
    y = skill_line(c, "Developer Tools:", "Git, GitHub, Maven, VS Code, IntelliJ IDEA", y)

    c.showPage()
    c.save()


if __name__ == "__main__":
    build()
