const fs = require('fs');
const path = require('path');

// ---- Helper classes ----
class Employee {
    constructor(emp_id, max_hours, salary, learning_rate, teaching_rate, skills, vacation) {
        this.emp_id = parseInt(emp_id);
        this.max_hours = parseInt(max_hours);
        this.salary = parseInt(salary);
        this.learning_rate = parseInt(learning_rate);
        this.teaching_rate = parseInt(teaching_rate);
        this.skills = skills[0] === '_' ? new Set() : new Set(skills);
        this.vacation = new Set(vacation.filter(v => v !== '_').map(v => parseInt(v)));
        this.trained_skills = new Set(this.skills);
        this.training_points = {};
    }
}

class Day {
    constructor(day_id, start = null, end = null, revenue = 0, skills = []) {
        this.day_id = parseInt(day_id);
        this.start = start !== null ? parseInt(start) : null;
        this.end = end !== null ? parseInt(end) : null;
        this.revenue = revenue;
        this.skills = skills;
        this.closed = start === null;
    }
}

// ---- Parsing input ----
function parseInput(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));

    const [overtimeModifier, fixedDailyCost] = lines[0].split(' ').map(Number);

    // Skip first two lines (overtime + fixed cost + number of days)
    let idx = 2;
    const days = [];

    // Parse days
    while (idx < lines.length) {
        const parts = lines[idx].split(' ');
        if (parts.length === 1) { // closed day
            days.push(new Day(parts[0]));
        } else if (parts.length >= 5) { // open day
            const day_id = parts[0];
            const start = parts[1];
            const end = parts[2];
            const revenue = parseInt(parts[3]);
            const skillsCSV = parts.slice(4).join(' ');
            const skills = skillsCSV.split(',');
            days.push(new Day(day_id, start, end, revenue, skills));
        } else {
            break;
        }
        idx++;
    }

    // Parse employees
    const employees = [];
    while (idx < lines.length) {
        const parts = lines[idx].split(' ');
        if (parts.length < 6) {
            idx++;
            continue;
        }
        const [emp_id, max_hours, salary, lr, tr, skillsCSV, vacationCSV] = parts;
        const skills = skillsCSV.split(',');
        const vacation = vacationCSV ? vacationCSV.split(',') : ['_'];
        employees.push(new Employee(emp_id, max_hours, salary, lr, tr, skills, vacation));
        idx++;
    }

    return { overtimeModifier, fixedDailyCost, days, employees };
}

// ---- Generate simple schedule ----
function generateSchedule(days, employees) {
    const output = [];

    for (const day of days) {
        if (day.closed) {
            output.push(`${day.day_id} _`);
            continue;
        }

        const shiftTokens = [];
        for (const skill of day.skills) {
            for (const emp of employees) {
                if (emp.vacation.has(day.day_id)) continue;
                if (emp.trained_skills.has(skill) || true) { // greedy assign
                    shiftTokens.push(`${emp.emp_id}-${day.start}-${day.end}-${skill}`);
                    break; // assign one employee per skill
                }
            }
        }

        if (shiftTokens.length === 0) shiftTokens.push('_');
        output.push(`${day.day_id} ${shiftTokens.join(' ')}`);
    }

    return output;
}

// ---- Main ----
function main() {
    const inputFile = process.argv[2];
    const outputFile = process.argv[3];

    if (!inputFile || !outputFile) {
        console.error("Gebruik: node scheduler.js <inputbestand> <outputbestand>");
        process.exit(1);
    }

    const absInput = path.resolve(inputFile);
    const absOutput = path.resolve(outputFile);

    if (!fs.existsSync(absInput)) {
        console.error(`Inputbestand niet gevonden: ${absInput}`);
        process.exit(1);
    }

    const { overtimeModifier, fixedDailyCost, days, employees } = parseInput(absInput);
    const schedule = generateSchedule(days, employees);
    fs.writeFileSync(absOutput, schedule.join('\n'));
    console.log(`Output geschreven naar ${absOutput}`);
}

main();
