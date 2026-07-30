import type { Favorite } from './types'

export function updateFavorite(favorites: Favorite[], updated: Favorite): Favorite[] {
  return favorites.map(favorite => favorite.id === updated.id ? updated : favorite)
}
