// Reuse the oldest slot once the particle array reaches its configured capacity.
// Keeping the array itself bounded avoids transient dead entries during large bursts.
export function insertCappedParticle(particles, particle, limit, cursor) {
  if (particles.length < limit) {
    particles.push(particle);
    cursor.index = particles.length % limit;
    return null;
  }

  const index = cursor.index % particles.length;
  cursor.index = (index + 1) % particles.length;
  const previous = particles[index];
  particles[index] = particle;
  return previous;
}
