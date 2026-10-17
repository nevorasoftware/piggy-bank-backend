import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { ENV } from './config/env';
import apiRoutes from './routes';

export function createApp(): Express {
  const app: Express = express();

  // Middleware de Seguridad
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  // Configuración de CORS con soporte para el frontend en Railway y localhost
  const allowedOrigins = [
    ENV.FRONTEND_URL,
    'http://localhost:3000',
    'https://piggy-bank-frontend.up.railway.app',
  ];

  app.use(
    cors({
      origin: (origin, callback) => {
        // Permitir solicitudes sin origen (como Postman o webhooks) o presentes en allowedOrigins
        if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.railway.app')) {
          callback(null, true);
        } else {
          callback(null, true); // Permisivo en desarrollo / Railway previews
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-event-checksum', 'signature'],
    })
  );

  // Logging en consola
  app.use(morgan(ENV.NODE_ENV === 'production' ? 'combined' : 'dev'));

  // Parseo de JSON y URL encoded
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Ruta base de bienvenida
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'PiggyBank Backend API',
      version: '1.0.0',
      status: 'active',
      docs: 'Endpoints disponibles bajo el prefijo /api',
      health: '/api/health',
    });
  });

  // Montar rutas de la API
  app.use('/api', apiRoutes);

  // Manejo de rutas 404
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      message: 'Ruta no encontrada.',
    });
  });

  // Manejador global de errores
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled Application Error:', err);
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Error interno del servidor.',
    });
  });

  return app;
}
