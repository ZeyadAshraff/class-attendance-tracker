// Frontend settings.
// useMockData: true  -> pages use the placeholder data in mock-api.js (no backend needed)
// useMockData: false -> pages call the three services below with fetch()
// When the services are deployed, replace the localhost addresses with the API Gateway URLs.
export const CONFIG = {
  useMockData: true,
  services: {
    student: 'http://localhost:3001',
    session: 'http://localhost:3002',
    course: 'http://localhost:3003'
  }
};
