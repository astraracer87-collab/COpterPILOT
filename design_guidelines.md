# Design Guidelines: Drone Pre-Flight Check App (iOS)

## Brand Identity

**Purpose**: Enable drone pilots to conduct thorough pre-flight checks with confidence, integrating regulatory compliance, weather assessment, and airspace verification.

**Aesthetic Direction**: Aviation-grade professional. Inspired by cockpit instrumentation and aviation charts - precise, trustworthy, high-contrast for outdoor readability. Think digital glass cockpit meets modern minimalism. Clean lines, tactical color coding (green/amber/red), generous whitespace for focused decision-making.

**Memorable Element**: The Go/Caution/No-Go weather assessment with color-coded status cards and clear reasoning. Pilots should instantly recognize the app's distinctive weather timeline visualization and traffic-light decision system.

## Navigation Architecture

**Root Navigation**: Tab Bar (4 tabs + FAB)
1. **Briefing** (Home) - Active flight checks
2. **History** - Past flight logs
3. **[FAB]** "New Check" - Primary action, floating button centered above tab bar
4. **Settings** - Limits, units, drone profiles

**Screen Stack**:
- Briefing Tab Stack: Briefing List → Flight Check Flow (modal)
- Flight Check Flow (modal full-screen stack): Checklist → Map WebView → Restrictions Dialog → Weather → Results
- History Tab Stack: History List → Briefing Detail
- Settings Tab Stack: Settings → Edit Limits → Drone Profiles

## Screen Specifications

### 1. Briefing List (Home)
- **Header**: Default navigation, title "Briefings", right button "Filter" icon
- **Layout**: Scrollable list, safe area top: headerHeight + Spacing.xl, bottom: tabBarHeight + Spacing.xl
- **Empty State**: Shows empty-briefings.png illustration, "No briefings yet" headline, "Tap + to start a pre-flight check" subtext
- **List Items**: Card style, shows date/time, location, Go/Caution/No-Go badge, tap to view details

### 2. Flight Check Flow (Modal)
**Navigation**: Full-screen modal with custom header showing progress (e.g., "Step 1 of 5")

#### 2a. Checklist Screen
- **Header**: Custom, left: "Cancel" (confirmation alert), center: "Pre-Flight Checklist", progress indicator
- **Layout**: Scrollable form, grouped sections (Legal, Mission, Hardware, Environment, Safety), safe area top: headerHeight + Spacing.xl, bottom: insets.bottom + Spacing.xl
- **Components**: Section headers, checkboxes with labels, info icons (tap for tooltips)
- **Footer**: "Continue" button (disabled until all required items checked), positioned above safe area

#### 2b. Map WebView Screen
- **Header**: Custom, left: "Back", center: "Airspace Check", right: none
- **Layout**: Full-screen WebView loading dipul Map Tool, safe area top: headerHeight, bottom: insets.bottom
- **Components**: WebView displaying `https://maptool-dipul.dfs.de/@{lon},{lat}?language=de&zoom=13`
- **Footer**: "Done" button overlay (floating, bottom-right corner, drop shadow as specified)

#### 2c. Restrictions Dialog (Sheet)
- **Layout**: Bottom sheet modal over map
- **Components**: "Were there restrictions?" headline, two buttons "Yes" / "No", if Yes: multi-select chips (Flight Prohibited, Approval Required, Height Limit, Other) + text field for notes
- **Action**: "Continue" button in header

#### 2d. Weather Screen
- **Header**: Custom, left: "Back", center: "Weather Assessment"
- **Layout**: Scrollable, safe area top: headerHeight + Spacing.xl, bottom: insets.bottom + Spacing.xl
- **Components**: 
  - Current conditions card (temp, wind, precipitation)
  - 2-hour timeline (horizontal scroll, 15-min intervals, each showing temp/wind/rain icons)
  - "Check Against Limits" button (prominent, centered)
- **Floating Element**: None

#### 2e. Results Screen
- **Header**: Custom, left: none, center: "Flight Assessment", right: "Done"
- **Layout**: Scrollable, centered content, safe area top: headerHeight + Spacing.xl, bottom: insets.bottom + Spacing.xl
- **Components**:
  - Large status card: Go (green), Caution (amber), or No-Go (red) with icon
  - "Reasons" list (bullet points explaining assessment)
  - "Save Briefing" button
  - Timestamp and location auto-saved

### 3. History List
- **Header**: Default navigation, title "History", search bar
- **Layout**: Scrollable list, safe area top: headerHeight + Spacing.xl, bottom: tabBarHeight + Spacing.xl
- **Empty State**: empty-history.png, "No flight history", "Your saved briefings will appear here"
- **List Items**: Date, location, status badge, tap to view

### 4. Settings
- **Header**: Default navigation, title "Settings"
- **Layout**: Scrollable grouped list, safe area top: headerHeight + Spacing.xl, bottom: tabBarHeight + Spacing.xl
- **Sections**:
  - Weather Limits (tap → Edit Limits screen)
  - Drone Profiles (tap → Profiles list)
  - Units (m/s vs km/h, °C vs °F)
  - About/Legal

## Color Palette

**Primary**: Aviation Blue `#0A4D8C` (trustworthy, professional)
**Accent Green (Go)**: `#2D8659` (safe to fly)
**Accent Amber (Caution)**: `#D97706` (proceed with care)
**Accent Red (No-Go)**: `#C53030` (do not fly)

**Background**: `#F5F7FA` (soft gray, reduces eye strain)
**Surface**: `#FFFFFF` (cards, forms)
**Border**: `#D1D5DB` (subtle dividers)

**Text Primary**: `#1A202C` (high contrast)
**Text Secondary**: `#4A5568` (labels, metadata)
**Text Tertiary**: `#A0AEC0` (placeholders, hints)

## Typography

**Font**: SF Pro (iOS system font) - reliable, optimized for readability
**Type Scale**:
- Title (Large): 28pt, Bold (screen titles)
- Title (Medium): 22pt, Semibold (section headers)
- Body: 17pt, Regular (main content)
- Callout: 16pt, Regular (list items)
- Caption: 13pt, Regular (metadata, timestamps)

## Visual Design

- **Cards**: White background, 12px corner radius, 1px border (#D1D5DB), no shadow for static cards
- **Buttons**: Primary (Aviation Blue background, white text, 10px radius), Secondary (outline, blue text)
- **Floating Action Button**: 64px circle, Aviation Blue, white "+" icon, drop shadow (offset: 0,2; opacity: 0.10; radius: 2)
- **Status Badges**: 6px radius, color-coded background (green/amber/red at 10% opacity), colored text
- **Icons**: Feather icons from @expo/vector-icons, 24px default size
- **Checkboxes**: 24px, rounded, Aviation Blue when checked

## Assets to Generate

1. **icon.png** - App icon: Stylized drone silhouette with checklist checkmark overlay, Aviation Blue and white
   - WHERE USED: Device home screen

2. **splash-icon.png** - Splash screen logo: Same as app icon
   - WHERE USED: App launch screen

3. **empty-briefings.png** - Illustration: Clipboard with drone outline, subtle Aviation Blue tones
   - WHERE USED: Briefing List empty state

4. **empty-history.png** - Illustration: Archive box with clock icon, muted colors
   - WHERE USED: History List empty state

5. **weather-status-go.png** - Icon: Checkmark in circle, green, minimal
   - WHERE USED: Weather Results screen (Go status)

6. **weather-status-caution.png** - Icon: Exclamation in triangle, amber, minimal
   - WHERE USED: Weather Results screen (Caution status)

7. **weather-status-nogo.png** - Icon: X in octagon, red, minimal
   - WHERE USED: Weather Results screen (No-Go status)