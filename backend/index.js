require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const auclassesRoutes = require('./routes/classes');
const elevesRoutes = require('./routes/eleves');
const enseignantsRoutes = require('./routes/enseignants');
const personnelsRoute= require('./routes/personnel')
const matiereRoute = require('./routes/matiereRoute');
const financesRoute = require('./routes/finances');
const affectationRoute=require('./routes/affectationRoute')
const administrateurRoute = require('./routes/administrateur');
const systemRoute = require('./routes/system');
const superadminRoute = require('./routes/superadmin');
const systemController = require('./controllers/systemController');
const activityLogger = require('./middleware/activityLogger');
const db = require('./database/db');
const app = express();
const path = require('path');
app.use(cors());
app.use(express.json());
app.use('/api', activityLogger);

app.use('/api/auth', authRoutes);
app.use('/api/classes', auclassesRoutes);
app.use('/api/eleves', elevesRoutes);
app.use('/api/enseignants', enseignantsRoutes); 
app.use('/api/personnels',personnelsRoute);
app.use('/api/matieres', matiereRoute);
app.use('/api/finances', financesRoute);
app.use('/api/affectation',affectationRoute)
app.use('/api/administrateur', administrateurRoute);
app.use('/api/system', systemRoute);
app.use('/api/superadmin', superadminRoute);
app.get('/api/public/bulletins/:id', systemController.verifyBulletinPublic);
const PORT = process.env.PORT || 5000;
// Servir les fichiers statiques du frontend (après les routes API)
app.use(express.static(path.join(__dirname, '../unitech-frontend/dist')));


// Middleware de fallback pour le SPA (après les routes API et statiques)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../unitech-frontend/dist/index.html'));
});

(async () => {
  try {
    await db.ready;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Serveur accessible sur http://votre-ip:${PORT}`);
    });
  } catch (error) {
    console.error('Erreur initialisation base Supabase/PostgreSQL:', error);
    process.exit(1);
  }
})();
