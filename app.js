const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const cors = require('cors');


const app = express();
const port = process.env.PORT|| 3000;

const jwtSecretKey = 's3cr3tK3y!@#';


app.use(cors());
app.use(cors({ origin: '*' }));

// Middleware for JSON body parsing
app.use(express.json());

const mongodbURL = 'mongodb+srv://razk95:01236987@placebook.or7miii.mongodb.net/';
// Connect to MongoDB

// Define MongoDB schemas
const userSchema = new mongoose.Schema({
    name: String,
    email: String,
    password: String,
    isAdmin: { type: Boolean, default: false }
});

const placeSchema = new mongoose.Schema({
    title: String,
    description: String,
    location: String,
    photo: String,
    user: {
        _id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        name: String
    },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    comments: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        content: String,
        createdAt: { type: Date, default: Date.now }
    }],
    ratings: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        rating: { type: Number, min: 1, max: 5 },
        createdAt: { type: Date, default: Date.now }
    }],
    averageRating: { type: Number, default: 0 }
});

// Define calculateAverageRating method for the placeSchema
placeSchema.methods.calculateAverageRating = function () {
    const ratings = this.ratings.map(rating => rating.rating);
    const sum = ratings.reduce((acc, rating) => acc + rating, 0);
    this.averageRating = ratings.length > 0 ? sum / ratings.length : 0;
};

// Define MongoDB models
const User = mongoose.model('User', userSchema);
const Place = mongoose.model('Place', placeSchema);


// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExtension = path.extname(file.originalname);
        cb(null, uniqueSuffix + fileExtension);
    }
});

const upload = multer({ storage: storage });

// Middleware for authenticating requests
async function authenticate(req, res, next) {
    const token = req.header('Authorization');
    if (!token) return res.status(401).send('Access denied. No token provided.');

    try {
        const decoded = jwt.verify(token, jwtSecretKey);
        const user = await User.findById(decoded._id);
        if (!user) return res.status(401).send('Invalid token. User not found.');

        req.user = user;
        next();
    } catch (ex) {
        res.status(400).send('Invalid token.');
    }
}

// User registration
app.post('/api/users/register', async (req, res) => {
    const { name, email, password } = req.body;

    // Check if user already exists
    let user = await User.findOne({ email });
    if (user) return res.status(400).send('User already registered.');

    // Create a new user
    user = new User({ name, email, password });
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(user.password, salt);
    await user.save();


    res.status(201).json({ message: 'User registered successfully.' });
});

// User login
app.post('/api/users/login', async (req, res) => {
    const { email, password } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) return res.status(400).send('Invalid email or password.');

    // Validate password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).send('Invalid email or password.');

    // Generate JWT
    const token = jwt.sign({ _id: user._id, isAdmin: user.isAdmin }, jwtSecretKey);

    res.status(200).send({ 'token': token });
});

// Post a new place
app.post('/api/places', authenticate, upload.single('photo'), async (req, res) => {
    // Check if file was uploaded
    if (!req.file) {
        return res.status(400).send('No file was uploaded.');
    }

    const { title, description, location } = req.body;

    // Get the file path from the uploaded photo
    const photoPath = req.file.filename;

    try {
        // Find the user who published the post
        const user = await User.findById(req.user._id);

        // Create a new place with the photo path and user details
        const place = new Place({
            title,
            description,
            location,
            photo: photoPath,
            user: {
                _id: user._id,
                name: user.name
            }
        });

        await place.save();

        res.status(201).send(place);
    } catch (error) {
        res.status(500).send('An error occurred while saving the place.');
    }
});



// Comment on a place
app.post('/api/places/:id/comments', authenticate, async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;

    // Find the place by ID
    const place = await Place.findById(id);
    if (!place) return res.status(404).send('Place not found.');

    // Add comment
    place.comments.push({ user: req.user._id, content });
    await place.save();

    res.status(201).send(place.comments);
});

// Rate a place
app.post('/api/places/:id/ratings', authenticate, async (req, res) => {
    const { id } = req.params;
    const { rating } = req.body;

    // Find the place by ID
    const place = await Place.findById(id);
    if (!place) return res.status(404).send('Place not found.');

    // Add or update rating
    const userRating = place.ratings.find(r => r.user.equals(req.user._id));
    if (userRating) {
        userRating.rating = rating;
    } else {
        place.ratings.push({ user: req.user._id, rating });
    }
    await place.save();

    // Calculate average rating
    place.calculateAverageRating();
    await place.save();

    res.send(place.ratings);
});

// Get all places with images
app.get('/api/places', authenticate, async (req, res) => {
    try {
        const places = await Place.find()
            .populate('user._id', 'name')
            .lean();

        // Add absolute URL for the image and like status
        places.forEach((place) => {
            place.photo = req.protocol + '://' + req.get('host') + '/uploads/' + place.photo;
            place.isLiked = place.likes.some((like) => like.toString() === req.user._id.toString());
        });

        res.send(places);
    } catch (error) {
        res.status(500).send('An error occurred while processing your request.');
    }
});

// Get all places without authentication
app.get('/api/places/all', async (req, res) => {
    try {
        const places = await Place.find()
            .populate('user._id', 'name')
            .lean();

        // Add absolute URL for the image and like status
        places.forEach((place) => {
            place.photo = req.protocol + '://' + req.get('host') + '/uploads/' + place.photo;
        });

        res.send(places);
    } catch (error) {
        res.status(500).send('An error occurred while processing your request.');
    }
});



// Like a place
app.post('/api/places/:id/like', authenticate, async (req, res) => {
    const { id } = req.params;

    try {
        const place = await Place.findById(id);
        if (!place) return res.status(404).send('Place not found.');

        // Check if the user has already liked the place
        if (place.likes.includes(req.user._id)) {
            return res.status(400).send('You have already liked this place.');
        }

        // Add user's like to the place
        place.likes.push(req.user._id);
        await place.save();

        res.status(201).json({ message: 'Place liked successfully.' });
    } catch (error) {
        res.status(500).send('An error occurred while processing your request.');
    }
});

// Unlike a place
app.post('/api/places/:id/unlike', authenticate, async (req, res) => {
    const { id } = req.params;

    try {
        const place = await Place.findById(id);
        if (!place) return res.status(404).send('Place not found.');

        // Check if the user has already liked the place
        if (!place.likes.includes(req.user._id)) {
            return res.status(400).send('You have not liked this place.');
        }

        // Remove user's like from the place
        place.likes.pull(req.user._id);
        await place.save();

        res.status(201).json({ message: 'Place unliked successfully.' });
    } catch (error) {
        res.status(500).send('An error occurred while processing your request.');
    }
});

// API endpoint for deleting a post
app.delete('/api/places/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Find the post by its ID and delete it
        const deletedPlace = await Place.findByIdAndDelete(id);

        if (!deletedPlace) {
            return res.status(404).json({ error: 'Place not found' });
        }

        res.json({ message: 'Post deleted successfully' });
    } catch (err) {
        console.error('Failed to delete post:', err);
        res.status(500).json({ error: 'Failed to delete post' });
    }
});




// Serve uploaded images statically
app.use('/uploads', express.static('uploads'));
app.use('/favicon.ico', express.static(path.join(__dirname, 'favicon.ico')));

app.get('/', async (req, res) => {
    res.status(200).send('OK')
})

// Serve the favicon.ico file
app.get('/favicon.ico', (req, res) => {
    const faviconPath = path.join(__dirname, 'favicon.ico');
    res.sendFile(faviconPath);
});


// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);

    mongoose.connect(mongodbURL, { useNewUrlParser: true, useUnifiedTopology: true })
        .then(() => console.log('Connected to MongoDB'))
        .catch(err => console.error('Failed to connect to MongoDB', err));



});
