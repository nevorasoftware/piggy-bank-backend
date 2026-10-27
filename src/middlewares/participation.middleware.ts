import { Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { getElSalvadorDateString } from '../utils/date';
import { AuthRequest } from './auth.middleware';

export interface ParticipationValidationResult {
  allowed: boolean;
  reason?: string;
  stats: {
    participaciones: number;
    victorias: number;
    maxParticipaciones: number;
    maxVictorias: number;
    fecha: string;
  };
}

/**
 * Función central de validación de reglas 6/3 según GameConfig y DailyUserStats.
 * Se ejecuta tanto antes de iniciar checkout en Wompi como en el procesamiento del Webhook.
 */
export async function puedeParticipar(userId: string): Promise<ParticipationValidationResult> {
  // 0. Los administradores no pueden adquirir pases ni participar en los sorteos
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (user?.role === 'ADMIN') {
    return {
      allowed: false,
      reason: 'Los administradores no pueden adquirir pases ni participar en sorteos. Tu cuenta tiene acceso exclusivo para gestión de salas y verificación de pagos.',
      stats: {
        participaciones: 0,
        victorias: 0,
        maxParticipaciones: 0,
        maxVictorias: 0,
        fecha: getElSalvadorDateString(),
      },
    };
  }

  // 1. Obtener configuración global de juego
  let config = await prisma.gameConfig.findFirst({
    where: { id: 1 },
  });

  if (!config) {
    config = await prisma.gameConfig.create({
      data: {
        id: 1,
        maxParticipacionesDia: 6,
        maxVictoriasDia: 3,
      },
    });
  }

  // 2. Obtener fecha de hoy en zona horaria America/El_Salvador
  const fechaHoy = getElSalvadorDateString();

  // 3. Buscar o crear estadísticas del usuario para el día actual
  let dailyStats = await prisma.dailyUserStats.findUnique({
    where: {
      userId_fecha: {
        userId,
        fecha: fechaHoy,
      },
    },
  });

  if (!dailyStats) {
    dailyStats = await prisma.dailyUserStats.create({
      data: {
        userId,
        fecha: fechaHoy,
        participaciones: 0,
        victorias: 0,
      },
    });
  }

  const resultStats = {
    participaciones: dailyStats.participaciones,
    victorias: dailyStats.victorias,
    maxParticipaciones: config.maxParticipacionesDia,
    maxVictorias: config.maxVictoriasDia,
    fecha: fechaHoy,
  };

  // 4. Validar límite de participaciones diarias
  if (dailyStats.participaciones >= config.maxParticipacionesDia) {
    return {
      allowed: false,
      reason: `Has alcanzado el límite máximo diario de ${config.maxParticipacionesDia} participaciones permitidas. Por juego responsable, podrás volver a participar mañana a partir de las 00:00 (Hora El Salvador).`,
      stats: resultStats,
    };
  }

  // 5. Validar límite de victorias diarias
  if (dailyStats.victorias >= config.maxVictoriasDia) {
    return {
      allowed: false,
      reason: `¡Felicidades por tu suerte! Has alcanzado el límite diario de ${config.maxVictoriasDia} victorias. Para garantizar juego responsable y equidad, tu cuenta podrá participar de nuevo mañana a partir de las 00:00.`,
      stats: resultStats,
    };
  }

  return {
    allowed: true,
    stats: resultStats,
  };
}

/**
 * Middleware de Express para endpoints de compra y verificación de participación.
 */
export async function participationGuardMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user?.id || (req.body && req.body.userId);

  if (!userId) {
    res.status(401).json({
      success: false,
      message: 'Usuario no identificado para validar reglas de participación.',
    });
    return;
  }

  try {
    const check = await puedeParticipar(userId);

    if (!check.allowed) {
      res.status(403).json({
        success: false,
        code: 'PARTICIPATION_LIMIT_REACHED',
        message: check.reason,
        stats: check.stats,
      });
      return;
    }

    // Adjuntar resultado a la petición para uso en controladores
    (req as any).participationStats = check.stats;
    next();
  } catch (error) {
    console.error('Error en participationGuardMiddleware:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno al validar reglas de participación.',
    });
  }
}
