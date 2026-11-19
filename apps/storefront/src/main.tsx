import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ShopifyProductPage } from './ShopifyProductPage';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShopifyProductPage />
  </StrictMode>,
);
