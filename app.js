const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = express();
const PORT = 3000;

app.use(express.json());

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './database.sqlite',
});

const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    username: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.ENUM('student', 'professor'), allowNull: false },
});

const Availability = sequelize.define('Availability', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    professorId: { type: DataTypes.INTEGER, allowNull: false },
    timeSlot: { type: DataTypes.STRING, allowNull: false },
    isBooked: { type: DataTypes.BOOLEAN, defaultValue: false },
});

const Appointment = sequelize.define('Appointment', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    studentId: { type: DataTypes.INTEGER, allowNull: false },
    professorId: { type: DataTypes.INTEGER, allowNull: false },
    timeSlot: { type: DataTypes.STRING, allowNull: false },
});

User.hasMany(Availability, { foreignKey: 'professorId' });
Availability.belongsTo(User, { foreignKey: 'professorId' });
User.hasMany(Appointment, { foreignKey: 'studentId' });
User.hasMany(Appointment, { foreignKey: 'professorId' });
Appointment.belongsTo(User, { foreignKey: 'studentId' });
Appointment.belongsTo(User, { foreignKey: 'professorId' });

const authenticate = async (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).send('Unauthorized');
    try {
        const decoded = jwt.verify(token, 'secret');
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).send('Unauthorized');
    }
};

app.post('/register', async (req, res) => {
    console.log('Register request body:', req.body);
    const { username, password, role } = req.body;
    const hash = await bcrypt.hash(password, 10);
    try {
        const user = await User.create({ username, password: hash, role });
        console.log('User registered:', user);
        res.status(201).json(user);
    } catch (err) {
        console.error('Registration error:', err);
        res.status(400).json(err);
    }
});

app.post('/login', async (req, res) => {
    console.log('Login request body:', req.body);
    const { username, password } = req.body;
    const user = await User.findOne({ where: { username } });
    if (!user) {
        console.log('User not found:', username);
        return res.status(404).send('User not found');
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
        console.log('Invalid credentials for user:', username);
        return res.status(401).send('Invalid credentials');
    }

    const token = jwt.sign({ id: user.id, role: user.role }, 'secret', { expiresIn: '1h' });
    console.log('Token generated for user:', username);
    res.json({ token });
});

app.post('/availability', authenticate, async (req, res) => {
    console.log('Availability request by user:', req.user);
    if (req.user.role !== 'professor') return res.status(403).send('Forbidden');

    const { timeSlot } = req.body;
    console.log('Availability time slot:', timeSlot);
    const availability = await Availability.create({ professorId: req.user.id, timeSlot });
    console.log('Availability created:', availability);
    res.status(201).json(availability);
});

app.get('/availability/:professorId', authenticate, async (req, res) => {
    console.log('Fetching availability for professorId:', req.params.professorId);
    const { professorId } = req.params;
    const slots = await Availability.findAll({ where: { professorId, isBooked: false } });
    console.log('Available slots:', slots);
    res.json(slots);
});

app.post('/appointments', authenticate, async (req, res) => {
    console.log('Appointment booking request by user:', req.user);
    if (req.user.role !== 'student') return res.status(403).send('Forbidden');

    const { professorId, timeSlot } = req.body;
    console.log('Booking appointment for professorId:', professorId, 'timeSlot:', timeSlot);
    const slot = await Availability.findOne({ where: { professorId, timeSlot, isBooked: false } });
    if (!slot) {
        console.log('Slot not available for booking');
        return res.status(404).send('Slot not available');
    }

    slot.isBooked = true;
    await slot.save();

    const appointment = await Appointment.create({ studentId: req.user.id, professorId, timeSlot });
    console.log('Appointment booked:', appointment);
    res.status(201).json(appointment);
});

app.delete('/appointments/:appointmentId', authenticate, async (req, res) => {
    console.log('Delete appointment request by user:', req.user);
    const { appointmentId } = req.params;
    const appointment = await Appointment.findByPk(appointmentId);
    if (!appointment) {
        console.log('Appointment not found:', appointmentId);
        return res.status(404).send('Appointment not found');
    }
    if (appointment.professorId !== req.user.id) {
        console.log('Forbidden request to delete appointment:', appointmentId);
        return res.status(403).send('Forbidden');
    }

    console.log('Cancelling appointment:', appointment);
    await Availability.update(
        { isBooked: false },
        { where: { professorId: appointment.professorId, timeSlot: appointment.timeSlot } }
    );
    await appointment.destroy();
    res.status(204).send();
});

app.get('/appointments', authenticate, async (req, res) => {
    console.log('Fetching appointments for user:', req.user);
    const appointments = await Appointment.findAll({ where: { studentId: req.user.id } });
    console.log('Appointments fetched:', appointments);
    res.json(appointments);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost/${PORT}`)
});

(async () => {
    if (require.main === module) {
        console.log('Starting test script...');

        try {
            console.log('Synchronizing database with { force: true }...');
            await sequelize.sync({ force: true });
            console.log('Database synchronized.');

            console.log('Initializing supertest...');
            const supertest = require('supertest');
            const request = supertest(app);
            console.log('Supertest initialized.');

            console.log('Registering professor...');
            const professorRes = await request.post('/register').send({ username: 'profP1', password: 'pass123', role: 'professor' });
            console.log('Professor registered:', professorRes.body);

            console.log('Registering student...');
            const studentRes = await request.post('/register').send({ username: 'studentA', password: 'pass123', role: 'student' });
            console.log('Student registered:', studentRes.body);

            console.log('Logging in professor...');
            const professorLoginRes = await request.post('/login').send({ username: 'profP1', password: 'pass123' });
            const professorToken = professorLoginRes.body.token;
            console.log('Professor logged in. Token:', professorToken);

            console.log('Logging in student...');
            const studentLoginRes = await request.post('/login').send({ username: 'studentA', password: 'pass123' });
            const studentToken = studentLoginRes.body.token;
            console.log('Student logged in. Token:', studentToken);

            console.log('Adding professor availability...');
            const availabilityRes = await request.post('/availability').set('Authorization', professorToken).send({ timeSlot: '2024-12-20 10:00' });
            console.log('Professor availability added:', availabilityRes.body);

            console.log('Booking an appointment...');
            const appointmentRes = await request.post('/appointments').set('Authorization', studentToken).send({ professorId: professorRes.body.id, timeSlot: '2024-12-20 10:00' });
            console.log('Appointment booked:', appointmentRes.body);

            console.log('Tests completed successfully.');
        } catch (err) {
            console.error('Test execution failed:', err.message);
            console.error('Error details:', err);
        }
    }
})();